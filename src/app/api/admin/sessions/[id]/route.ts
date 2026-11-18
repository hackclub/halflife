import { and, or } from "@prisma/orm-postgres/orm-client"
import { after } from "next/server"
import { recomputeActiveDays, recomputeWeek } from "@/lib/analytics"
import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAuditTx, requestInfo } from "@/lib/audit"
import { HoursSource, Phase, PhaseStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { lockKey } from "@/lib/locks"
import { Permission } from "@/lib/permissions"
import { statusFor } from "@/lib/phase"
import db from "@/lib/prisma8"
import { isPhaseDecided } from "@/lib/program"
import { scheduleRepoSync } from "@/lib/repo-sync"
import { sessionHoursSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * An admin correcting the claimed hours on one journal entry, after it has been submitted.
 *
 * The participant can only fix an entry while its week is open, so a wrong figure that is noticed after submission is stuck. This route is the way out. It writes only `hoursClaimed`, and leaves `hoursApproved` alone: a reviewer's figure is a decision already made, and changing it is what un-approve and re-review are for.
 *
 * A week still in review is refused, because a reviewer is reading these hours and a number that moves under them makes the review meaningless. A decided week is allowed: its frozen total and coins do not move, so the response says so, and the admin re-reviews the week to pay the corrected figure.
 *
 * The maker's own rules still apply to the number itself: an entry with self-reported hours may not put more than 24 hours on its day, and nobody corrects their own entries. Admins are not exempt from the second pair of eyes.
 */
export const PATCH = withWritePermission(
	Permission.OVERRIDE_DECISIONS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, sessionHoursSchema)
		if (parsed.error) return parsed.error
		const { hoursClaimed, reason } = parsed.data

		const session = await db.orm.public.WorkSession.where({ deletedAt: null, id })
			.include("themeProject", project => project.select("buildStatus", "designStatus", "id", "userId"))
			.first()
		const owner = session?.themeProject
		if (!session || !owner) return fail("NOT_FOUND", "Journal entry not found")
		if (owner.userId === gate.user.id)
			return fail("FORBIDDEN", "You cannot correct the hours on your own journal entry")

		const phaseStatus = statusFor(owner, session.phase)
		if (phaseStatus === PhaseStatus.in_review)
			return fail(
				"PHASE_LOCKED",
				"This week is in review, so its hours are with the reviewer. Change them once it is decided.",
			)

		const before = session.hoursClaimed
		const decided = isPhaseDecided(phaseStatus)
		const { ip, userAgent } = await requestInfo()

		await db.transaction(async tx => {
			// The same per-person lock the maker's own journal writes take, so the daily total below cannot be read
			// before a parallel entry commits and then raise the day over 24 hours.
			await lockKey(tx, `journal:${owner.userId}`)

			if (session.hoursSource === HoursSource.MANUAL) {
				const { claimedToday } = await tx.orm.public.WorkSession.where({
					deletedAt: null,
					effectiveDate: session.effectiveDate,
					hoursSource: HoursSource.MANUAL,
				})
					.where(row =>
						row.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.eq(owner.userId))),
					)
					.where(row => row.id.neq(id))
					.aggregate(a => ({ claimedToday: a.sum("hoursClaimed") }))
				if ((claimedToday ?? 0) + hoursClaimed > 24)
					throw new HttpError(
						"VALIDATION_FAILED",
						"That would put more than 24 hours of self-reported work on one day.",
					)
			}

			// Conditional on the phase still not being in review: a claim that lands between the read above and this write makes the update match nothing, and the change is refused rather than written under a reviewer.
			const changed = await tx.orm.public.WorkSession.where({ deletedAt: null, id })
				.where(row =>
					or(
						and(
							row.phase.eq(Phase.DESIGN),
							row.themeProject.some(project => project.designStatus.neq(PhaseStatus.in_review)),
						),
						and(
							row.phase.eq(Phase.BUILD),
							row.themeProject.some(project => project.buildStatus.neq(PhaseStatus.in_review)),
						),
					),
				)
				.updateAndCount({ hoursClaimed })
			if (changed !== 1) throw new HttpError("PHASE_LOCKED", "This week moved while its hours were being changed")

			// In the transaction: the audit row is the only record of who changed a paid figure, and `logAudit`
			// swallows a failure, which would leave the change with no trace.
			await logAuditTx(tx, {
				action: AuditAction.ADMIN_UPDATE_SESSION_HOURS,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				ip,
				metadata: {
					after: hoursClaimed,
					before,
					decided,
					phase: session.phase,
					reason,
					themeProjectId: owner.id,
					weekNumber: session.weekNumber,
				},
				targetId: id,
				targetType: "WorkSession",
				userAgent,
			})
		})

		after(async () => {
			await recomputeWeek(owner.userId, session.weekNumber)
			// Moving a claim changes which days counted as active, exactly as the maker's own edit does.
			await recomputeActiveDays(owner.userId)
			await scheduleRepoSync(owner.id)
		})

		return ok({ decided, hoursClaimed, id })
	},
)
