import { markSubmission } from "@/lib/analytics"
import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { phaseReasonSchema } from "@/lib/schemas/admin"
import { submitPhase } from "@/lib/submissions"
import { propagateSubmission } from "@/lib/submit-effects"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * An admin hands a phase in on a maker's behalf, past the programme's timing gates.
 *
 * The maker's own rules still hold: the phase state (no double hand-in, design before build), the fraud hold, a description, a cover, at least one logged hour, the tier's hour floor, and evidence ownership. What the admin cannot give is the maker's agreement, so a parts shortfall still refuses until the maker agrees to it themselves. The hand-in is recorded under the admin's name in the audit log, with the reason.
 */
export const POST = withWritePermission(
	Permission.OVERRIDE_DECISIONS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, phaseReasonSchema)
		if (parsed.error) return parsed.error
		const { phase, reason } = parsed.data

		const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id }).select("userId").first()
		if (!project) return fail("NOT_FOUND", "Project not found")
		if (project.userId === gate.user.id) return fail("FORBIDDEN", "You cannot force a hand-in on your own project")

		const submission = await submitPhase(project.userId, id, phase, null, [], false, false, false, { force: true })

		await markSubmission(project.userId)

		await logAudit({
			action: AuditAction.ADMIN_FORCE_SUBMIT_PHASE,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { ownerId: project.userId, phase, reason, submissionId: submission.id },
			targetId: id,
			targetType: "ThemeProject",
		})

		propagateSubmission(gate.user, project.userId, id, phase, submission.scheduledWeek)

		return ok({ submission }, { status: 201 })
	},
)
