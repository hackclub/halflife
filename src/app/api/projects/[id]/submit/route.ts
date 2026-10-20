import { after } from "next/server"
import { syncLoopsWeekSubmitted } from "@/lib/airtable/loops"
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

interface Params {
	params: Promise<{ id: string }>
}

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
		parsed.data.partialFundingAccepted,
		parsed.data.fundingDeclined,
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
		},
		targetId: id,
		targetType: "ThemeProject",
	})

	// Into the YSWS table as "Pending Review" – the table reviewers work from on ari.hackclub.com. After the response, so a slow Airtable never holds up a hand-in; a failure lands in the audit log and the retry job replays it.
	after(async () => {
		await trackSideEffect(
			"airtable",
			{
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: { phase: parsed.data.phase },
				targetId: id,
				targetType: "ThemeProject",
			},
			() => syncSubmissionToYsws(id, parsed.data.phase),
		)
	})

	// Tick the week's `ProjectSubmitted` box on the maker's Signups row, so Loops can trigger off the hand-in without waiting for the hourly sync. Best-effort: a skip or a fault only delays the tick until `loops-sync` heals it, so it must never fail the hand-in.
	after(async () => {
		try {
			if (submission.scheduledWeek != null) await syncLoopsWeekSubmitted(gate.user.id, submission.scheduledWeek)
		} catch (err) {
			console.error("[submit] loops submitted tick failed:", err)
		}
	})

	// And into Ari, which reviews it through the SDK and reports back by webhook. Only scheduled when configured, so a deployment without Ari secrets logs no noise; a failure lands in the audit log and /api/integrations/ari-retry.
	if (isAriConfigured())
		after(async () => {
			await trackSideEffect(
				"ari",
				{
					actorEmail: gate.user.email,
					actorId: gate.user.id,
					metadata: { phase: parsed.data.phase },
					targetId: id,
					targetType: "ThemeProject",
				},
				() => sendSubmissionToAri(id, parsed.data.phase),
			)
		})

	// Warm the Hackatime cache now so the reviewer opens a page with fresh numbers instead of waiting on the API. The participant does not need to wait for it.
	after(async () => {
		const links = await prisma.hackatimeLink.findMany({
			select: { id: true },
			where: { phase: parsed.data.phase, themeProjectId: id },
		})
		for (const link of links)
			await refreshLinkCache(link.id).catch(err => console.error("[submit] hackatime refresh failed:", err))
	})

	return ok({ submission }, { status: 201 })
})
