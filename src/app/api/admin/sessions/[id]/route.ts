import { and, or } from "@prisma/orm-postgres/orm-client"
import { after } from "next/server"
import { recomputeWeek } from "@/lib/analytics"
import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { Phase, PhaseStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
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

		const phaseStatus = statusFor(owner, session.phase)
		if (phaseStatus === PhaseStatus.in_review)
			return fail(
				"PHASE_LOCKED",
				"This week is in review, so its hours are with the reviewer. Change them once it is decided.",
			)

		const before = session.hoursClaimed
		const decided = isPhaseDecided(phaseStatus)

		await db.transaction(async tx => {
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
		})

		await logAudit({
			action: AuditAction.ADMIN_UPDATE_SESSION_HOURS,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
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
		})

		after(async () => {
			await recomputeWeek(owner.userId, session.weekNumber)
			await scheduleRepoSync(owner.id)
		})

		return ok({ decided, hoursClaimed, id })
	},
)
