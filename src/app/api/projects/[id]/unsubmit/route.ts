import { after } from "next/server"
import { removeSubmissionFromYsws } from "@/lib/airtable/sync"
import { ok, parseBody, withRoute } from "@/lib/api"
import { isAriConfigured, withdrawSubmissionFromAri } from "@/lib/ari"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import { unsubmitSchema } from "@/lib/schemas/project"
import { trackSideEffect } from "@/lib/side-effects"
import { unsubmitPhase } from "@/lib/submissions"

type Params = { params: Promise<{ id: string }> }

export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
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

	// Taken back before review, so its row goes too – otherwise reviewers on ari would see a hand-in that no longer exists. `removed` marks the row gone, so the next submission of this phase writes a fresh one.
	after(async () => {
		await trackSideEffect(
			"airtable",
			{
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: { phase: parsed.data.phase, removed: true },
				targetId: id,
				targetType: "ThemeProject",
			},
			() => removeSubmissionFromYsws(id, parsed.data.phase),
		)
	})

	// Withdraw it from Ari too, or its queue keeps a hand-in that no longer exists in Half Life.
	if (isAriConfigured()) {
		after(async () => {
			await trackSideEffect(
				"ari",
				{
					actorEmail: gate.user.email,
					actorId: gate.user.id,
					metadata: { phase: parsed.data.phase, withdrawn: true },
					targetId: id,
					targetType: "ThemeProject",
				},
				() => withdrawSubmissionFromAri(id, parsed.data.phase),
			)
		})
	}

	return ok({ ok: true })
})
