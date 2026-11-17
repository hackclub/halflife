import { ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withWriteSession } from "@/lib/guards"
import { unsubmitSchema } from "@/lib/schemas/project"
import { unsubmitPhase } from "@/lib/submissions"
import { propagateWithdrawal } from "@/lib/withdraw-effects"

interface Params {
	params: Promise<{ id: string }>
}

export const POST = withWriteSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, unsubmitSchema)
	if (parsed.error) return parsed.error

	await unsubmitPhase(gate.user.id, id, parsed.data.phase)

	await logAudit({
		action: AuditAction.USER_UNSUBMIT_PHASE,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { phase: parsed.data.phase },
		targetId: id,
		targetType: "ThemeProject",
	})

	propagateWithdrawal(gate.user, gate.user.id, id, parsed.data.phase)

	return ok({ ok: true })
})
