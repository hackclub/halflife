"use client"

import { claim, decide, ReviewApiError, releaseQuietly, request, saveSessionHours } from "@/components/review/api"
import { type QueuedReview, readViewer, removePack, updateOutbox } from "@/components/review/offline/store"

/**
 * Sends a review made offline, through the routes an online review uses – claim, hours, decision – so every rule they enforce holds and Airtable, Loops, Slack and the ledger hear about it as usual.
 *
 * Checked first against the submission as it stands now, the way Fabricate's offline sync is: one that someone has since decided, or that someone else holds the claim on, is refused; one whose journal changed after it was downloaded is reported, and sent only if the reviewer says so.
 */

export interface Conflicts {
	/** Reasons it can't be sent. */
	hard: string[]
	/** Things that changed since it was downloaded, worth a look before sending. */
	soft: string[]
}

interface CurrentState {
	priorReviews: { createdAt: string }[]
	sessions: { createdAt: string; id: string; title?: string; updatedAt: string }[]
	submission: {
		claim: {
			expiresAt: string
			reviewer?: { displayName?: string | null; name?: string | null } | null
			reviewerId: string
		} | null
		resolvedAt: string | null
		resolvedResult: string | null
	}
}

export async function checkConflicts(id: string, queued: QueuedReview): Promise<Conflicts> {
	const state = await request<CurrentState>(`/api/review/submissions/${encodeURIComponent(id)}`, { method: "GET" })
	const viewer = await readViewer()
	const hard: string[] = []
	const soft: string[] = []
	const { submission } = state
	if (submission.resolvedAt)
		hard.push(
			`Already ${String(submission.resolvedResult).toLowerCase()} (${new Date(submission.resolvedAt).toLocaleString()}).`,
		)
	const { claim: held } = submission
	if (held && held.reviewerId !== viewer?.id && Date.parse(held.expiresAt) > Date.now())
		hard.push(`${held.reviewer?.displayName ?? held.reviewer?.name ?? "Another reviewer"} is reviewing this now.`)
	const packedAt = Date.parse(queued.packedAt)
	for (const session of state.sessions) {
		const title = session.title?.trim().replaceAll(/\s+/g, " ") ?? ""
		const name = title ? `“${title.length > 60 ? `${title.slice(0, 57)}…` : title}”` : "An entry"
		if (Date.parse(session.createdAt) > packedAt)
			soft.push(`${name} was added to the journal after you downloaded this.`)
		else if (Date.parse(session.updatedAt) > packedAt) soft.push(`${name} was changed after you downloaded this.`)
	}
	if (state.priorReviews.some(review => Date.parse(review.createdAt) > packedAt))
		soft.push("A review was recorded on this project after you downloaded it.")
	return { hard, soft }
}

/** Sends one queued review: claim, then hours, then the decision. Anything sent is taken out of the outbox as it lands, so a failure part-way leaves only what didn't go. */
export async function sendReview(id: string, queued: QueuedReview): Promise<void> {
	try {
		await claim(id)
		for (const hours of Object.values(queued.hours)) {
			await saveSessionHours(hours)
			await updateOutbox(outbox => {
				const entry = outbox[id]
				if (entry) delete entry.hours[hours.id]
			})
		}
		// A decision ends the claim itself; hours alone hand it back, so nobody else is locked out until it times out.
		if (queued.decision) await decide(id, queued.decision)
		else await releaseQuietly(id)
	} catch (err) {
		const message = err instanceof ReviewApiError || err instanceof Error ? err.message : String(err)
		await updateOutbox(outbox => {
			const entry = outbox[id]
			if (entry) entry.error = message
		})
		throw err
	}
	await updateOutbox(outbox => {
		delete outbox[id]
	})
	// Decided: nothing left to review here. Hours alone leave the download in place.
	if (queued.decision) await removePack(id)
}
