import { fail, ok, parseBody } from "@/lib/api"
import { PhaseStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { statusFor } from "@/lib/phase"
import db from "@/lib/prisma8"
import { isIreConfigured } from "@/lib/ire-platform"
import { getIreShipRow, sendSubmissionToIre } from "@/lib/ire-shadow"
import { phaseBodySchema } from "@/lib/schemas/common"
import { trackSideEffect } from "@/lib/side-effects"

interface Params {
	params: Promise<{ id: string }>
}

export const maxDuration = 60

/**
 * Re-send one shadow hand-in to Review. Same work the hourly ire-retry job does, for the submission an admin is looking at.
 *
 * A phase awaiting review has at most one open local submission; a stale IreShip row from an earlier hand-in is replaced by the send itself. Nothing here is a decision path.
 */
export const POST = withWritePermission(
	Permission.MANAGE_PROGRAM,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, phaseBodySchema)
		if (parsed.error) return parsed.error

		if (!isIreConfigured()) return fail("NOT_CONFIGURED", "Review is not configured on this deployment")

		const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id })
			.select("buildStatus", "designStatus")
			.first()
		if (!project) return fail("NOT_FOUND", "Project not found")
		if (statusFor(project, parsed.data.phase) !== PhaseStatus.in_review)
			return fail("CONFLICT", "That phase is not awaiting review, so there is no ship to send")

		const open = await db.orm.public.PhaseSubmission.where({
			phase: parsed.data.phase,
			resolvedAt: null,
			themeProjectId: id,
		})
			.orderBy(submission => submission.createdAt.desc())
			.select("id")
			.first()
		if (!open) return fail("CONFLICT", "That phase has no open submission to send")

		const ship = await getIreShipRow(id, parsed.data.phase)
		if (ship?.remoteId && ship.closedAt === null && ship.lastSubmissionId === open.id)
			return fail("CONFLICT", "That submission already reached Review, so there is nothing to retry")

		try {
			const result = await trackSideEffect(
				"review",
				{
					actorEmail: gate.user.email,
					actorId: gate.user.id,
					metadata: { manual: true, phase: parsed.data.phase, shadow: true },
					targetId: id,
					targetType: "ThemeProject",
				},
				() => sendSubmissionToIre(id, parsed.data.phase),
				{ rethrow: true },
			)
			return ok({ result })
		} catch (err) {
			if (err instanceof HttpError) return fail(err.code, err.message)
			return fail("UNAVAILABLE", "Review did not accept the ship; the audit log has the error")
		}
	},
)
