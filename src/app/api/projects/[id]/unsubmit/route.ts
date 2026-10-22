import { after } from "next/server"
import { syncLoopsWeekSubmitted } from "@/lib/airtable/loops"
import { removeSubmissionFromYsws } from "@/lib/airtable/sync"
import { ok, parseBody } from "@/lib/api"
import { isAriConfigured, withdrawSubmissionFromAri } from "@/lib/ari"
import { AuditAction, logAudit } from "@/lib/audit"
import { scheduledWeekFor } from "@/lib/config/program"
import { type AuthedContext, withSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { unsubmitSchema } from "@/lib/schemas/project"
import { trackSideEffect } from "@/lib/side-effects"
import { unsubmitPhase } from "@/lib/submissions"

interface Params {
	params: Promise<{ id: string }>
}

export const POST = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
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

	// The week's box is recomputed, not just cleared: withdrawing the only hand-in for a week unticks `ProjectSubmitted`, while an older hand-in standing behind it keeps it ticked. Best-effort like the submit tick – the hourly sync heals whatever this misses.
	after(async () => {
		try {
			const project = await prisma.themeProject.findUnique({ select: { theme: true }, where: { id } })
			if (project) await syncLoopsWeekSubmitted(gate.user.id, scheduledWeekFor(project.theme, parsed.data.phase))
		} catch (err) {
			console.error("[unsubmit] loops submitted tick failed:", err)
		}
	})

	// Withdraw it from Ari too, or its queue keeps a hand-in that no longer exists in Half Life.
	if (isAriConfigured())
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

	return ok({ ok: true })
})
