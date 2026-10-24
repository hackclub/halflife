import { sendSubmissionToAri, withdrawSubmissionFromAri } from "../src/lib/ari"
import { Phase } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { trackSideEffect } from "../src/lib/side-effects"

/** The hand-in a refresh replaces and the id Ari holds for its current ship, if any. */
export interface AriRefreshTarget {
	ariSubmissionId: string | null
	phase: Phase
	submissionId: string
	themeProjectId: string
}

/** The state a hand-in was left in, so a summary can tell a fresh send from a replaced ship. */
export type AriRefreshOutcome = "not-queued" | "replaced" | "sent"

/** The value of a `--name value` or `--name=value` flag, or null when it is absent. */
export function flag(name: string): string | null {
	const args = process.argv.slice(2)
	for (const [index, arg] of args.entries()) {
		if (arg === `--${name}`) return args[index + 1] ?? null
		if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3)
	}
	return null
}

/** The `--phase` flag as a phase, or null when it was not given. */
export function phaseArg(): Phase | null {
	const raw = flag("phase")
	if (raw === null) return null
	const phase = raw.toUpperCase()
	if (phase === Phase.DESIGN || phase === Phase.BUILD) return phase
	throw new Error(`--phase must be design or build, got ${raw}`)
}

/** The `--limit` flag as a positive integer, or null when it was not given. */
export function limitArg(): number | null {
	const raw = flag("limit")
	if (raw === null) return null
	const value = Number(raw)
	if (!Number.isInteger(value) || value <= 0) throw new Error(`--limit must be a positive integer, got ${raw}`)
	return value
}

/**
 * Send one hand-in with its current evidence, replacing the ship Ari already holds.
 *
 * Ari has no update-in-place API: a ship's journals and project keys are fixed at ingestion. A ship already in Ari is therefore withdrawn and created again under the same external id, which becomes the next version. `not_queued` means Ari holds no open ship under that id – usually because it has already decided it – and re-sending would put a decided hand-in back in the queue, so it is reported and left alone.
 */
export async function refreshAriShip(target: AriRefreshTarget): Promise<AriRefreshOutcome> {
	let replaced = false
	if (target.ariSubmissionId) {
		const withdrawn = await trackSideEffect(
			"ari",
			{
				actorId: null,
				metadata: { backfill: true, phase: target.phase, withdrawn: true },
				targetId: target.themeProjectId,
				targetType: "ThemeProject",
			},
			() => withdrawSubmissionFromAri(target.themeProjectId, target.phase),
			{ rethrow: true },
		)
		if (withdrawn && "status" in withdrawn) {
			if (withdrawn.status === "not_queued") return "not-queued"
			replaced = true
		}
		// The old ship is gone, so its id must go too: if the send below fails, `ari-retry` has to see this hand-in as unsent rather than skip it because a stale id says it already reached Ari.
		await db.orm.public.PhaseSubmission.where({ id: target.submissionId, resolvedAt: null }).updateAll({
			ariSubmissionId: null,
		})
	}

	const sent = await trackSideEffect(
		"ari",
		{
			actorId: null,
			metadata: { backfill: true, phase: target.phase, refreshed: target.ariSubmissionId !== null },
			targetId: target.themeProjectId,
			targetType: "ThemeProject",
		},
		() => sendSubmissionToAri(target.themeProjectId, target.phase),
		{ rethrow: true },
	)
	if (!sent || "skipped" in sent) throw new Error("Ari is not configured, or the hand-in is no longer awaiting review")
	return replaced ? "replaced" : "sent"
}
