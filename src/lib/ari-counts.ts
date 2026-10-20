import { type Phase, PhaseStatus, ReviewResult } from "@/app/generated/prisma/enums"

/**
 * How Ari's review board breaks down, counted the way Ari counts it.
 *
 * Ari keeps a row per ship, not per project: resubmitting a phase after a change request creates a new ship and leaves the old one on the board with the decision it was given. Its dashboard therefore counts every version, and a project sent back four times contributes four "changes" rows and one pending one. Half Life's `PhaseSubmission` rows are that same sequence – `submitPhase` inserts a new one for every hand-in – so the local mirror has to count all of them too. Collapsing to the newest per phase is what made the console read hundreds of change requests short: every one of those rows had been superseded by a resubmission and silently dropped.
 *
 * Two kinds of row are not on Ari's board and are counted nowhere:
 *
 * - A row Ari never received (`ariSubmissionId` null). It is waiting on us, not on a reviewer; the admin page counts it apart.
 * - An older open row for a phase that has since been handed in again. Ari holds at most one open ship per `external_id` – one (project, phase) – so a stale row is either a reverted ship the local reset left behind or an old ship a newer hand-in has replaced.
 *
 * A pending row only counts while its phase is actually `in_review`: a reverted or un-approved ship is terminal at Ari, and keeping it here would make the console's pending figure outrun the queue reviewers can open.
 *
 * Pure and order-independent, so `verify:contracts` can pin the rules without a database. This is the figure the admin reviewer-activity ring shows, and the one a human compares with Ari's own board – the failure it exists to prevent is a page that quietly disagrees with the queue.
 */
export interface AriShipRow {
	ariSubmissionId: string | null
	createdAt: Date
	id: string
	phase: Phase
	/** The project's status for this row's phase. */
	phaseStatus: PhaseStatus
	resolvedAt: Date | null
	/** The decision standing on a resolved row, or null when none is recorded. */
	result: ReviewResult | null
	themeProjectId: string
}

export interface AriShipCounts {
	approved: number
	changes: number
	/** Open ships Ari holds, one per phase at most. */
	pending: number
	rejected: number
	/** Current hand-ins that are in review here but never reached Ari. */
	unreached: number
}

function newer(a: AriShipRow, b: AriShipRow): boolean {
	const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime()
	if (byCreatedAt !== 0) return byCreatedAt > 0
	// Two rows can share a millisecond; the id keeps the choice stable between runs.
	return a.id > b.id
}

export function countAriShips(rows: readonly AriShipRow[]): AriShipCounts {
	// The newest submission per phase is the one a reviewer would be looking at; only it can be pending. Every resolved row still counts, because each one is its own ship.
	const current = new Map<string, AriShipRow>()
	for (const row of rows) {
		const key = `${row.themeProjectId}:${row.phase}`
		const seen = current.get(key)
		if (!seen || newer(row, seen)) current.set(key, row)
	}

	// Keyed by Ari's ship id rather than by row: two local rows can only point at one ship through a data fault, and counting it twice would invent a ship Ari does not have.
	const decided = new Map<string, AriShipRow>()
	for (const row of rows) {
		if (row.resolvedAt === null || row.ariSubmissionId === null) continue
		const seen = decided.get(row.ariSubmissionId)
		if (!seen || newer(row, seen)) decided.set(row.ariSubmissionId, row)
	}

	const counts: AriShipCounts = { approved: 0, changes: 0, pending: 0, rejected: 0, unreached: 0 }
	for (const row of decided.values())
		if (row.result === ReviewResult.APPROVED) counts.approved += 1
		else if (row.result === ReviewResult.RETURNED) counts.changes += 1
		else if (row.result === ReviewResult.REJECTED) counts.rejected += 1

	for (const row of current.values()) {
		if (row.resolvedAt !== null || row.phaseStatus !== PhaseStatus.in_review) continue
		if (row.ariSubmissionId === null) counts.unreached += 1
		else counts.pending += 1
	}

	return counts
}
