import "server-only"
import { Phase, PhaseStatus, PostStatus } from "@/app/generated/prisma/enums"
import { DESIGN_WEEKS } from "@/lib/config/program"
import { progressReelHours } from "@/lib/curriculum"
import { HttpError } from "@/lib/errors"
import prisma from "@/lib/prisma"
import { isWeekOpen } from "@/lib/program"

/**
 * Deleting a reel, and the debt it leaves.
 *
 * A reel checkpoint is done while a live reel carries its key, so deleting the
 * last one reopens the checkpoint by itself. What this adds is the other half:
 * until that reel is re-recorded, nothing else on the map moves. Every other
 * checkpoint is held, and the server refuses the work that would complete one
 * — a journal entry, a different checkpoint's reel, a submit.
 *
 * Only a week that can still take work can owe a reel. A week in review or
 * decided keeps its reels as the record it was judged on, and a passed week
 * can never be re-recorded, so neither can have a reel deleted from it. That
 * is what keeps the debt payable: anything owed is always somewhere the maker
 * can go and pay it.
 */

/** Idea and progress reels. The closing reel lives inside Submit, not on its own node. */
const REDOABLE = /^w([1-9]|10)-reel-(idea|\d{1,2})$/

function weekOfKey(key: string): number | null {
	const m = /^w(\d{1,2})-reel-/.exec(key)
	return m ? Number(m[1]) : null
}

/**
 * "your week 3 idea reel", "your week 2 15h progress reel".
 *
 * The hours come from `progressReelHours` rather than from arithmetic on the
 * slot, because the two used to disagree: this said `slot * 10` while the trail
 * put a build week's second reel at five hours, so an owed-reel message could
 * name a mark the maker never had. One source, and the phase is read off the
 * week the same way `reelLockReason` reads it.
 *
 * A warm-up's reel has no week to read a phase from, so it is named without one
 * rather than guessed at — "your progress reel" is true; "your 15h progress
 * reel" might not be.
 */
export function reelNameForKey(key: string): string {
	const week = weekOfKey(key)
	const slot = /-reel-(.+)$/.exec(key)?.[1]
	const progress = slot && /^\d+$/.test(slot)
	// `curriculum` names the phases in lower case, as the trail does; the Prisma
	// enum is spelled the other way and is not what this takes.
	const phase = week === null ? null : week > DESIGN_WEEKS ? ("build" as const) : ("design" as const)
	const what = progress
		? phase
			? `${progressReelHours(phase, Number(slot))}h progress reel`
			: "progress reel"
		: slot === "idea"
			? "idea reel"
			: "reel"
	return week ? `your week ${week} ${what}` : `your ${what}`
}

/**
 * Whether a checkpoint reel's week still lets its reels change. Null when it
 * does; otherwise the reason, phrased for the maker.
 */
export async function reelLockReason(
	userId: string,
	themeProjectId: string | null,
	checkpointKey: string,
): Promise<string | null> {
	const week = weekOfKey(checkpointKey)
	if (!week || !themeProjectId) return null
	const project = await prisma.themeProject.findUnique({
		where: { id: themeProjectId },
		select: { designStatus: true, buildStatus: true },
	})
	if (!project) return null
	const phase = week > DESIGN_WEEKS ? Phase.BUILD : Phase.DESIGN
	const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
	if (status === PhaseStatus.in_review) return "This week is in review. Unsubmit it to delete its reels."
	if (status === PhaseStatus.approved || status === PhaseStatus.rejected) {
		return "This week has been reviewed, so its reels stay as the record."
	}
	if (!(await isWeekOpen(userId, themeProjectId, week))) return "This week has passed, so its reels stay."
	return null
}

/** The reel checkpoints this maker deleted and has not re-recorded yet. */
export async function getOwedReelKeys(userId: string): Promise<string[]> {
	const deleted = await prisma.post.findMany({
		where: { userId, status: PostStatus.REMOVED, deletedAt: { not: null }, checkpointKey: { not: null } },
		select: { checkpointKey: true, themeProjectId: true },
	})
	const projectByKey = new Map<string, string | null>()
	for (const p of deleted) {
		if (p.checkpointKey && REDOABLE.test(p.checkpointKey)) projectByKey.set(p.checkpointKey, p.themeProjectId)
	}
	if (projectByKey.size === 0) return []

	const live = await prisma.post.findMany({
		where: { userId, deletedAt: null, checkpointKey: { in: [...projectByKey.keys()] } },
		select: { checkpointKey: true },
	})
	for (const p of live) if (p.checkpointKey) projectByKey.delete(p.checkpointKey)

	const owed: string[] = []
	for (const [key, projectId] of projectByKey) {
		// Only a reel that can still be re-recorded holds anything up.
		if (projectId && (await reelLockReason(userId, projectId, key)) === null) owed.push(key)
	}
	return owed.sort()
}

/**
 * Refuse work while a deleted reel is owed. `checkpointKey` is the reel being
 * posted, if this is a reel: re-recording an owed one is the way out, so that
 * one — and only that one — goes through.
 */
export async function assertNoOwedReel(userId: string, checkpointKey?: string | null): Promise<void> {
	const owed = await getOwedReelKeys(userId)
	if (owed.length === 0) return
	if (checkpointKey && owed.includes(checkpointKey)) return
	const first = owed[0] as string
	throw new HttpError(
		"REEL_OWED",
		`Re-record ${reelNameForKey(first)} first. You deleted it, and the rest of the map waits until it is back.`,
	)
}
