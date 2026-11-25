import "server-only"
import { after } from "next/server"
import { syncLoopsWeekSubmitted } from "@/lib/airtable/loops"
import { removeSubmissionFromYsws } from "@/lib/airtable/sync"
import { isAriConfigured, withdrawSubmissionFromAri } from "@/lib/ari"
import { scheduledWeekFor } from "@/lib/config/program"
import type { Phase } from "@/lib/enums"
import db from "@/lib/prisma8"
import { trackSideEffect } from "@/lib/side-effects"

interface Actor {
	email: string
	id: string
}

/**
 * Everything outside Postgres that a withdrawn hand-in has to follow: its Airtable row, its Loops week tick, and its copy in the review queue.
 *
 * Called once the withdrawal has committed, from inside the request, so each step runs after the response. `actor` is who did it (the maker, or an admin); `ownerId` is whose project it is.
 */
export function propagateWithdrawal(actor: Actor, ownerId: string, themeProjectId: string, phase: Phase): void {
	// Taken back before review, so its row goes too – otherwise reviewers on ari would see a hand-in that no longer exists. `removed` marks the row gone, so the next submission of this phase writes a fresh one.
	after(async () => {
		await trackSideEffect(
			"airtable",
			{
				actorEmail: actor.email,
				actorId: actor.id,
				metadata: { phase, removed: true },
				targetId: themeProjectId,
				targetType: "ThemeProject",
			},
			() => removeSubmissionFromYsws(themeProjectId, phase),
		)
	})

	// The week's box is recomputed, not just cleared: withdrawing the only hand-in for a week unticks `ProjectSubmitted`, while an older hand-in standing behind it keeps it ticked. Best-effort like the submit tick – the hourly sync heals whatever this misses.
	after(async () => {
		try {
			const project = await db.orm.public.ThemeProject.whereUnique({ id: themeProjectId }).select("theme").first()
			if (project) await syncLoopsWeekSubmitted(ownerId, scheduledWeekFor(project.theme, phase))
		} catch (err) {
			console.error("[unsubmit] loops submitted tick failed:", err)
		}
	})

	// Withdraw it from review too, or the queue keeps a hand-in that no longer exists in Half Life.
	if (isAriConfigured())
		after(async () => {
			await trackSideEffect(
				"ari",
				{
					actorEmail: actor.email,
					actorId: actor.id,
					metadata: { phase, withdrawn: true },
					targetId: themeProjectId,
					targetType: "ThemeProject",
				},
				() => withdrawSubmissionFromAri(themeProjectId, phase),
			)
		})
}
