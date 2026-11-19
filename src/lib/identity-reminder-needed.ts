import "server-only"
import { PhaseStatus } from "@/lib/enums"
import { isIdentityVerified } from "@/lib/hca-profile"
import db from "@/lib/prisma8"

/**
 * How long one answer about a maker's identity is reused before HCA is asked again.
 *
 * Short on purpose: someone who has just verified on Hack Club Auth should stop being reminded within a couple of minutes of coming back, not after a long cache window. The shell mounts the reminder on every page, so the window is what keeps one open tab from asking HCA on every view.
 */
export const IDENTITY_RECHECK_MS = 2 * 60_000

/** The last answer per person, for this process. A restart just means the next view asks again. */
const lastAnswer = new Map<string, { at: number; needed: boolean }>()

/**
 * Whether the caller has not cleared Hack Club Auth's identity check, asked through the short cache above.
 *
 * `isIdentityVerified` only calls HCA when the stored status is not yes, so a verified maker costs nothing here. The answer is cached per person, so a page that asks on every view does not ask HCA on every view.
 */
export async function identityNeeded(userId: string): Promise<boolean> {
	const now = Date.now()
	const cached = lastAnswer.get(userId)
	if (cached && now - cached.at < IDENTITY_RECHECK_MS) return cached.needed

	const needed = !(await isIdentityVerified(userId))
	// Bounded rather than unbounded: an old entry is no worse than a miss.
	if (lastAnswer.size > 10_000) lastAnswer.clear()
	lastAnswer.set(userId, { at: now, needed })
	return needed
}

/**
 * Whether the caller has approved work and has not cleared Hack Club Auth's identity check.
 *
 * Approved work is the case the reminder is for: an approved design is what the grant waits on, and grants and shop orders are refused until the check passes. Makers without an approved design are not asked at all, so the check costs nothing for them.
 */
export async function identityReminderNeeded(userId: string): Promise<boolean> {
	const approved = await db.orm.public.ThemeProject.where({
		deletedAt: null,
		designStatus: PhaseStatus.approved,
		userId,
	})
		.select("id")
		.first()
	if (!approved) return false
	return identityNeeded(userId)
}
