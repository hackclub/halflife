import { after } from "next/server"
import { syncSubmissionToYsws } from "@/lib/airtable/sync"
import { markSubmission } from "@/lib/analytics"
import { ok, parseBody, withRoute } from "@/lib/api"
import { isAriConfigured, sendSubmissionToAri } from "@/lib/ari"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import { refreshLinkCache } from "@/lib/hackatime"
import prisma from "@/lib/prisma"
import { sanitizeOptional } from "@/lib/sanitize"
import { submitSchema } from "@/lib/schemas/project"
import { trackSideEffect } from "@/lib/side-effects"
import { submitPhase } from "@/lib/submissions"

type Params = { params: Promise<{ id: string }> }

export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, submitSchema)
	if (parsed.error) return parsed.error

	const submission = await submitPhase(
		gate.user.id,
		id,
		parsed.data.phase,
		sanitizeOptional(parsed.data.notes),
		parsed.data.attachmentKeys,
	)

	await markSubmission(gate.user.id)

	await logAudit({
		action: AuditAction.USER_SUBMIT_PHASE,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ThemeProject",
		targetId: id,
		metadata: { phase: parsed.data.phase, submissionId: submission.id },
	})

	// Into the YSWS table as "Pending Review" — the table reviewers work from on
	// ari.hackclub.com. After the response, so a slow Airtable never holds up a
	// hand-in; a failure lands in the audit log and the retry job replays it.
	after(async () => {
		await trackSideEffect(
			"airtable",
			{
				actorId: gate.user.id,
				actorEmail: gate.user.email,
				targetType: "ThemeProject",
				targetId: id,
				metadata: { phase: parsed.data.phase },
			},
			() => syncSubmissionToYsws(id, parsed.data.phase),
		)
	})

	// And into Ari, which reviews it through the SDK and reports back by webhook.
	// Only scheduled when configured, so a deployment without Ari secrets logs no
	// noise; a failure lands in the audit log and /api/integrations/ari-retry.
	if (isAriConfigured()) {
		after(async () => {
			await trackSideEffect(
				"ari",
				{
					actorId: gate.user.id,
					actorEmail: gate.user.email,
					targetType: "ThemeProject",
					targetId: id,
					metadata: { phase: parsed.data.phase },
				},
				() => sendSubmissionToAri(id, parsed.data.phase),
			)
		})
	}

	// Warm the Hackatime cache now so the reviewer opens a page with fresh
	// numbers instead of waiting on the API. The participant does not need to
	// wait for it.
	after(async () => {
		const links = await prisma.hackatimeLink.findMany({
			where: { themeProjectId: id, phase: parsed.data.phase },
			select: { id: true },
		})
		for (const link of links) {
			await refreshLinkCache(link.id).catch((err) => console.error("[submit] hackatime refresh failed:", err))
		}
	})

	return ok({ submission }, { status: 201 })
})
