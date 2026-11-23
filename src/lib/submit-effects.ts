import "server-only"
import { after } from "next/server"
import { syncLoopsWeekSubmitted } from "@/lib/airtable/loops"
import { syncSubmissionToYsws } from "@/lib/airtable/sync"
import { isAriConfigured, sendSubmissionToAri } from "@/lib/ari"
import type { Phase } from "@/lib/enums"
import { refreshLinkCache } from "@/lib/hackatime"
import { ireLive, isIreConfigured } from "@/lib/ire-platform"
import { sendSubmissionToIre } from "@/lib/ire-shadow"
import db from "@/lib/prisma8"
import { trackSideEffect } from "@/lib/side-effects"
import { isRobertConfigured, isSporkConfigured, screenWithSpork, submitToRobert } from "@/lib/telescreen"

interface Actor {
	email: string
	id: string
}

/**
 * Everything outside Postgres that a hand-in has to follow: its Airtable row, its Loops week tick, its place in the review queue, and a warm Hackatime cache for the reviewer.
 *
 * Called once the submission has committed, from inside the request, so each step runs after the response. `actor` is who did it (the maker, or an admin on their behalf); `ownerId` is whose project it is.
 */
export function propagateSubmission(
	actor: Actor,
	ownerId: string,
	themeProjectId: string,
	phase: Phase,
	scheduledWeek: number | null | undefined,
): void {
	// Into the YSWS table as "Pending Review" – the table reviewers work from on ari.hackclub.com. After the response, so a slow Airtable never holds up a hand-in; a failure lands in the audit log and the retry job replays it.
	after(async () => {
		await trackSideEffect(
			"airtable",
			{
				actorEmail: actor.email,
				actorId: actor.id,
				metadata: { phase },
				targetId: themeProjectId,
				targetType: "ThemeProject",
			},
			() => syncSubmissionToYsws(themeProjectId, phase),
		)
	})

	// Tick the week's `ProjectSubmitted` box on the maker's Signups row, so Loops can trigger off the hand-in without waiting for the hourly sync. Best-effort: a skip or a fault only delays the tick until `loops-sync` heals it, so it must never fail the hand-in.
	after(async () => {
		try {
			if (scheduledWeek !== null && scheduledWeek !== undefined) await syncLoopsWeekSubmitted(ownerId, scheduledWeek)
		} catch (err) {
			console.error("[submit] loops submitted tick failed:", err)
		}
	})

	// And into review. In live mode Ire owns the decision, so the hand-in goes there exclusively; otherwise Ari reviews it through the SDK and reports back by webhook. Only scheduled when configured, so a deployment without review secrets logs no noise; a failure lands in the audit log and the retry route.
	if (ireLive())
		after(async () => {
			await trackSideEffect(
				"ire",
				{
					actorEmail: actor.email,
					actorId: actor.id,
					metadata: { live: true, phase },
					targetId: themeProjectId,
					targetType: "ThemeProject",
				},
				() => sendSubmissionToIre(themeProjectId, phase),
			)
		})
	else {
		if (isAriConfigured())
			after(async () => {
				await trackSideEffect(
					"ari",
					{
						actorEmail: actor.email,
						actorId: actor.id,
						metadata: { phase },
						targetId: themeProjectId,
						targetType: "ThemeProject",
					},
					() => sendSubmissionToAri(themeProjectId, phase),
				)
			})

		// A shadow copy for Ire. Ari remains authoritative; this exists so Ire's checks and queue can be compared against Ari before any decision moves. No maker notice on failure: the maker never asked for a second review.
		if (isIreConfigured())
			after(async () => {
				await trackSideEffect(
					"ire",
					{
						actorEmail: actor.email,
						actorId: actor.id,
						metadata: { phase, shadow: true },
						targetId: themeProjectId,
						targetType: "ThemeProject",
					},
					() => sendSubmissionToIre(themeProjectId, phase),
				)
			})
	}

	// Telescreen's fraud review and copy check, as Fabricate runs them on every ship (see lib/telescreen). Each keeps its own failure on the project's row for the review screen, and `telescreen-sync` replays what was missed.
	if (isRobertConfigured())
		after(async () => {
			try {
				await submitToRobert(themeProjectId)
			} catch (err) {
				console.error("[submit] robert failed:", err)
			}
		})
	if (isSporkConfigured())
		after(async () => {
			try {
				await screenWithSpork(themeProjectId)
			} catch (err) {
				console.error("[submit] spork failed:", err)
			}
		})

	// Warm the Hackatime cache now so the reviewer opens a page with fresh numbers instead of waiting on the API. Nobody waits for it.
	after(async () => {
		const links = await db.orm.public.HackatimeLink.where({ phase, themeProjectId }).select("id").all()
		for (const link of links)
			await refreshLinkCache(link.id).catch(err => console.error("[submit] hackatime refresh failed:", err))
	})
}
