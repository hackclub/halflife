import { markSubmission } from "@/lib/analytics"
import { ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withWriteSession } from "@/lib/guards"
import { sanitizeOptional } from "@/lib/sanitize"
import { submitSchema } from "@/lib/schemas/project"
import { submitPhase } from "@/lib/submissions"
import { propagateSubmission } from "@/lib/submit-effects"

interface Params {
	params: Promise<{ id: string }>
}

export const POST = withWriteSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, submitSchema)
	if (parsed.error) return parsed.error

	const submission = await submitPhase(
		gate.user.id,
		id,
		parsed.data.phase,
		sanitizeOptional(parsed.data.notes),
		parsed.data.attachmentKeys,
		parsed.data.partialFundingAccepted,
		parsed.data.fundingDeclined,
		parsed.data.noMicrocontroller,
	)

	await markSubmission(gate.user.id)

	await logAudit({
		action: AuditAction.USER_SUBMIT_PHASE,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: {
			phase: parsed.data.phase,
			submissionId: submission.id,
			// What the maker agreed to, if they had to agree to anything: an over-budget cart is funded up to the tier and the rest is theirs, or nothing at all when they declined funding.
			...(submission.partialFundingAccepted
				? { fundingCapUsd: submission.fundingCapUsd, requestedBomUsd: submission.requestedBomUsd }
				: {}),
			...(submission.fundingDeclined ? { fundingDeclined: true } : {}),
			...(submission.noMicrocontroller ? { noMicrocontroller: true } : {}),
		},
		targetId: id,
		targetType: "ThemeProject",
	})

	propagateSubmission(gate.user, gate.user.id, id, parsed.data.phase, submission.scheduledWeek)

	return ok({ submission }, { status: 201 })
})
