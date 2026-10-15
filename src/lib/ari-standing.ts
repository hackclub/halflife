import type { AriShipStatus } from "@hackclub/ari"

/**
 * The decision standing on an Ari ship, as the webhook event names it.
 *
 * A reconciliation reads a ship's state with `ari.ships.status`, which reports the decision but not the event that carried it. The event name is derived here rather than at the call site so the mapping is one place, and pinned by `verify:contracts` – Ari's vocabulary ("changes") and its event name ("review.changes") are the two halves that could drift apart without anything else noticing.
 *
 * Null for a ship that is not final: still queued, withdrawn, or reverted. `reviewed` is the only phase that carries a decision.
 */
export type StandingDecision =
	| { decision: "approved"; event: "review.approved" }
	| { decision: "changes"; event: "review.changes" }
	| { decision: "rejected"; event: "review.rejected" }

export function standingDecision(status: Pick<AriShipStatus, "phase" | "decision">): StandingDecision | null {
	if (status.phase !== "reviewed") return null
	if (status.decision === "approved") return { decision: "approved", event: "review.approved" }
	if (status.decision === "changes") return { decision: "changes", event: "review.changes" }
	if (status.decision === "rejected") return { decision: "rejected", event: "review.rejected" }
	// A `reviewed` ship with no decision is a shape Ari does not mean to send; log rather than guess.
	console.warn("[ari] reviewed ship reported no decision; counted nowhere")
	return null
}
