import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { phaseReasonSchema } from "@/lib/schemas/admin"
import { withdrawFromReview } from "@/lib/submissions"
import { propagateWithdrawal } from "@/lib/withdraw-effects"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * An admin takes a submitted phase back out of review, the way the maker could before a reviewer picked it up.
 *
 * It needs `OVERRIDE_DECISIONS` because it reverses a hand-in someone else made. The same checks as the maker's unsubmit run: a reviewer holding a live claim refuses it, and a design cannot leave while its build is in review. The maker is not notified: the phase simply reads as draft (or needs changes, if its last decision was a return) on their next visit.
 */
export const POST = withWritePermission(
	Permission.OVERRIDE_DECISIONS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, phaseReasonSchema)
		if (parsed.error) return parsed.error
		const { phase, reason } = parsed.data

		const { userId } = await withdrawFromReview(id, phase)
		if (userId === gate.user.id) return fail("FORBIDDEN", "You cannot unsubmit your own project")

		await logAudit({
			action: AuditAction.ADMIN_UNSUBMIT_PHASE,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { ownerId: userId, phase, reason },
			targetId: id,
			targetType: "ThemeProject",
		})

		propagateWithdrawal(gate.user, userId, id, phase)

		return ok({ ok: true })
	},
)
