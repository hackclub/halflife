import { after } from "next/server"
import { z } from "zod"
import { PhaseStatus } from "@/app/generated/prisma/enums"
import { mirrorReviewDecision, reviewStatusFor } from "@/lib/airtable/sync"
import { ok, parseBody, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { notifyReviewOutcome } from "@/lib/notifications"
import { Permission } from "@/lib/permissions"
import { reopenPhase, unapprovePhase } from "@/lib/review"
import { sanitize } from "@/lib/sanitize"
import { overrideSchema } from "@/lib/schemas/review"

interface Params {
	params: Promise<{ id: string }>
}

const bodySchema = overrideSchema.extend({
	action: z.enum(["unapprove", "reopen"]),
})

/**
 * Reversing a decision.
 *
 * Un-approving reconciles the project's credit to zero rather than writing a compensating "reversal" kind, so the balance lands exactly where it started and re-approving later cannot double-pay.
 *
 * Both actions leave the phase on "needs changes", which is the one state a maker is expected to go and act on, so both tell them and both grant them a week to act with (`grantExtension`). The notification and the extension are here rather than inside `unapprovePhase`/`reopenPhase` because Ari's own revert calls them on its way back to "in review" – a transient state the maker never holds – and one message, and one week, per real change is the whole point.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.OVERRIDE_DECISIONS)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, bodySchema)
	if (parsed.error) return parsed.error
	const { action, phase, reason } = parsed.data

	const note = sanitize(reason)
	if (action === "unapprove")
		await unapprovePhase(id, phase, gate.user.id, gate.user.email, note, { grantExtension: true })
	else await reopenPhase(id, phase, gate.user.id, gate.user.email, note, { grantExtension: true })

	// After the response: the reversal has already committed, and a Slack or Airtable outage must not fail an admin's action.
	after(async () => {
		// Both actions leave the phase on "needs changes", so the row follows it there rather than keeping the decision that was just undone – and the note goes with that decision, so it is replaced by the admin's reason.
		await mirrorReviewDecision(id, phase, reviewStatusFor(PhaseStatus.update_requested), note || null)
		await notifyReviewOutcome({
			decidedBy: "console",
			note: note || null,
			phase,
			// Returned, not rejected: the maker can act on this one, which is exactly what `next` tells them.
			result: "RETURNED",
			themeProjectId: id,
		})
	})

	return ok({ ok: true })
})
