import "server-only"
import { or } from "@prisma/orm-postgres/orm-client"
import { ariExternalId } from "@/lib/ari-id"
import { type Phase, PhaseStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { statusFor } from "@/lib/phase"
import db from "@/lib/prisma8"
import { type PendingReviewShipItem, selectPendingReviewShips } from "@/lib/review-pending"
import {
	alreadyQueuedReviewShip,
	createReviewShip,
	getReviewShip,
	isReviewConfigured,
	type ReviewShipCreated,
	terminalReviewFailure,
	withdrawReviewShip,
} from "@/lib/review-platform"
import { buildReviewShipInput } from "@/lib/review-ship"
import { formatDbTimestamp } from "@/lib/time"

/**
 * The shadow copy of a hand-in in Review.
 *
 * Ari owns the decision; Review only observes. This module keeps the observed copy current: send it, close it when the local phase moves on, replace it when the maker hands in a new version, and record why a send failed. Nothing here applies a decision, writes credit, mirrors Airtable or notifies a maker.
 */

export type SendReviewResult =
	| { skipped: "not_configured" }
	| { id: string; status: "accepted" | "duplicate"; version?: number }

/** The row a Review ship is currently linked to, as the lifecycle checks need it. */
export interface ReviewShipRow {
	closedAt: string | null
	decision: string | null
	externalId: string
	id: string
	lastError: string | null
	lastSubmissionId: string | null
	phase: Phase
	remoteId: string | null
	themeProjectId: string
	version: number | null
}

function nowText(): string {
	return formatDbTimestamp(new Date())
}

async function recordShip(input: {
	closedAt?: string | null
	decision?: string | null
	externalId: string
	lastSubmissionId: string
	phase: Phase
	remoteId: string
	status: string
	themeProjectId: string
	version?: number
}): Promise<void> {
	const syncedAt = nowText()
	const fields = {
		closedAt: input.closedAt ?? null,
		decision: input.decision ?? null,
		externalId: input.externalId,
		lastError: null,
		lastSubmissionId: input.lastSubmissionId,
		remoteId: input.remoteId,
		status: input.status,
		syncedAt,
		version: input.version ?? null,
	}
	const existing = await db.orm.public.ReviewShip.where({
		phase: input.phase,
		themeProjectId: input.themeProjectId,
	})
		.select("id")
		.first()
	if (existing) {
		await db.orm.public.ReviewShip.where({ id: existing.id }).update(fields)
		return
	}
	try {
		await db.orm.public.ReviewShip.create({ ...fields, phase: input.phase, themeProjectId: input.themeProjectId })
	} catch (err) {
		// Two senders can race the first create. The unique index keeps one row; write this result over the winner.
		const raced = await db.orm.public.ReviewShip.where({
			phase: input.phase,
			themeProjectId: input.themeProjectId,
		})
			.select("id")
			.first()
		if (!raced) throw err
		await db.orm.public.ReviewShip.where({ id: raced.id }).update(fields)
	}
}

async function recordError(themeProjectId: string, phase: Phase, reason: string): Promise<void> {
	try {
		const existing = await db.orm.public.ReviewShip.where({ phase, themeProjectId }).select("id").first()
		if (existing) await db.orm.public.ReviewShip.where({ id: existing.id }).update({ lastError: reason })
		else
			await db.orm.public.ReviewShip.create({
				externalId: ariExternalId(themeProjectId, phase),
				lastError: reason,
				phase,
				themeProjectId,
			})
	} catch (err) {
		console.error(`[review] could not record the send failure for ${themeProjectId}:${phase}:`, err)
	}
}

async function withdrawRow(row: ReviewShipRow): Promise<"not_queued" | "withdrawn"> {
	const result = await withdrawReviewShip(row.externalId)
	await db.orm.public.ReviewShip.where({ id: row.id }).update({
		closedAt: nowText(),
		lastError: null,
		status: result.status,
	})
	return result.status
}

/**
 * Send a hand-in to Review, replacing a stale open copy when the maker has handed in again.
 *
 * Review holds at most one open ship per external id. In shadow mode its ships are not decided, so a resubmission would otherwise hit `already_queued` on the previous version forever. The `ReviewShip` row survives the local submission being deleted on unsubmit, which is why the mapping lives there rather than on `PhaseSubmission`.
 */
export async function sendSubmissionToReview(themeProjectId: string, phase: Phase): Promise<SendReviewResult> {
	if (!isReviewConfigured()) return { skipped: "not_configured" }

	const { input, submissionId } = await buildReviewShipInput(themeProjectId, phase)
	if (!submissionId) throw new HttpError("NOT_SUBMITTED", "This phase has no open submission to send to review")

	const existing = (await db.orm.public.ReviewShip.where({ phase, themeProjectId }).first()) as ReviewShipRow | null

	try {
		if (existing?.remoteId && existing.closedAt === null) {
			if (existing.lastSubmissionId === submissionId)
				return {
					id: existing.remoteId,
					status: "duplicate",
					...(existing.version === null ? {} : { version: existing.version }),
				}
			await withdrawRow(existing)
		}

		const created: ReviewShipCreated = await createReviewShip(input, submissionId)
		await recordShip({
			externalId: input.external_id,
			lastSubmissionId: submissionId,
			phase,
			remoteId: created.id,
			status: created.status,
			themeProjectId,
			version: created.version,
		})
		return created
	} catch (err) {
		const queued = alreadyQueuedReviewShip(err)
		if (queued) {
			// The open ship is one we do not have on record, or one whose withdraw raced this create. A single withdraw-and-retry clears the stale copy; if it fails, the error is recorded and the next run retries.
			if (existing?.remoteId && (existing.remoteId !== queued.id || existing.lastSubmissionId !== submissionId))
				try {
					await withdrawRow(existing)
					const retried = await createReviewShip(input, submissionId)
					await recordShip({
						externalId: input.external_id,
						lastSubmissionId: submissionId,
						phase,
						remoteId: retried.id,
						status: retried.status,
						themeProjectId,
						version: retried.version,
					})
					return retried
				} catch (retryErr) {
					const reason =
						terminalReviewFailure(retryErr) ?? (retryErr instanceof Error ? retryErr.message : String(retryErr))
					await recordError(themeProjectId, phase, reason)
					throw retryErr
				}

			// A response lost on the way back is the ship Review already has. Adopting it stops an hourly retry that can never succeed.
			await recordShip({
				externalId: input.external_id,
				lastSubmissionId: submissionId,
				phase,
				remoteId: queued.id,
				status: "duplicate",
				themeProjectId,
				version: queued.version,
			})
			return {
				id: queued.id,
				status: "duplicate",
				...(queued.version === undefined ? {} : { version: queued.version }),
			}
		}

		const reason = terminalReviewFailure(err) ?? (err instanceof Error ? err.message : String(err))
		await recordError(themeProjectId, phase, reason)
		throw err
	}
}

/** Withdraw an open hand-in from Review. A ship that is already gone is success. */
export async function withdrawSubmissionFromReview(
	themeProjectId: string,
	phase: Phase,
): Promise<{ skipped: "not_configured" } | { id: string | null; status: "not_queued" | "withdrawn" }> {
	if (!isReviewConfigured()) return { skipped: "not_configured" }

	const existing = (await db.orm.public.ReviewShip.where({ phase, themeProjectId }).first()) as ReviewShipRow | null
	try {
		const result = await withdrawReviewShip(ariExternalId(themeProjectId, phase))
		if (existing)
			await db.orm.public.ReviewShip.where({ id: existing.id }).update({
				closedAt: nowText(),
				lastError: null,
				status: result.status,
			})
		return result
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err)
		if (existing) await db.orm.public.ReviewShip.where({ id: existing.id }).update({ lastError: reason })
		else await recordError(themeProjectId, phase, reason)
		throw err
	}
}

/** What a close pass did. */
export interface ReviewCloseSummary {
	checked: number
	closed: number
	failed: number
	skipped: number
}

/**
 * Close the shadow copies of hand-ins whose local phase has left review.
 *
 * The submit path withdraws a stale copy before creating the next version, so this is the belt to that braces: it also catches an Ari decision, a console decision, an admin revert and an unsubmit whose withdrawal failed while Review was down. A ship with a newer open submission is skipped here; that path owns the replace.
 */
export async function closeResolvedReviewShips(opts: { limit?: number } = {}): Promise<ReviewCloseSummary> {
	const summary: ReviewCloseSummary = { checked: 0, closed: 0, failed: 0, skipped: 0 }
	if (!isReviewConfigured()) return summary

	const rows = await db.orm.public.ReviewShip.where({ closedAt: null })
		.where(row => row.remoteId.isNotNull())
		.orderBy(row => row.createdAt.asc())
		.limit(opts.limit ?? 100)
		.include("themeProject", project => project.select("buildStatus", "deletedAt", "designStatus"))
		.all()

	for (const row of rows) {
		summary.checked += 1
		const project = row.themeProject
		// A phase still in review either has this ship open or has a newer hand-in waiting on the send path, which withdraws this row itself. Neither is ours to close.
		if (project && project.deletedAt === null && statusFor(project, row.phase) === PhaseStatus.in_review) {
			summary.skipped += 1
			continue
		}

		try {
			await withdrawRow(row)
			summary.closed += 1
		} catch (err) {
			summary.failed += 1
			const reason = err instanceof Error ? err.message : String(err)
			await db.orm.public.ReviewShip.where({ id: row.id }).update({ lastError: reason })
		}
	}

	return summary
}

/** Replay the shadow sends that never reached Review, with the reason the last attempt gave. */
export async function findUnsyncedReviewSubmissions(): Promise<PendingReviewShipItem[]> {
	if (!isReviewConfigured()) return []

	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.where(project => or(project.designStatus.eq(PhaseStatus.in_review), project.buildStatus.eq(PhaseStatus.in_review)))
		.select("buildStatus", "designStatus", "id")
		.all()
	if (projects.length === 0) return []

	const ids = projects.map(project => project.id)
	const [submissions, ships] = await Promise.all([
		db.orm.public.PhaseSubmission.where({ resolvedAt: null })
			.where(submission => submission.themeProjectId.in(ids))
			.orderBy(submission => submission.createdAt.asc())
			.select("createdAt", "id", "phase", "themeProjectId")
			.all(),
		db.orm.public.ReviewShip.where(ship => ship.themeProjectId.in(ids))
			.select("closedAt", "decision", "lastError", "lastSubmissionId", "phase", "remoteId", "themeProjectId")
			.all(),
	])

	return selectPendingReviewShips(
		projects,
		submissions.map(submission => ({
			createdAt: new Date(submission.createdAt),
			id: submission.id,
			phase: submission.phase,
			themeProjectId: submission.themeProjectId,
		})),
		ships.map(ship => ({
			closedAt: ship.closedAt === null ? null : new Date(ship.closedAt),
			decision: ship.decision,
			lastError: ship.lastError,
			lastSubmissionId: ship.lastSubmissionId,
			phase: ship.phase,
			remoteId: ship.remoteId,
			themeProjectId: ship.themeProjectId,
		})),
	)
}

/** What a status refresh changed. */
export interface ReviewStatusSummary {
	checked: number
	failed: number
	missing: number
	updated: number
}

/**
 * Verify the open shadow ships still exist, and record the phase Review reports for the ones that do.
 *
 * The send response can be lost, and a ship can be withdrawn by an operator. A missing or withdrawn ship clears its remote id so the next pending pass sends it again; a live one keeps its version and phase current. This never reads or applies a decision.
 */
export async function refreshOpenReviewShips(opts: { limit?: number } = {}): Promise<ReviewStatusSummary> {
	const summary: ReviewStatusSummary = { checked: 0, failed: 0, missing: 0, updated: 0 }
	if (!isReviewConfigured()) return summary

	const rows = (await db.orm.public.ReviewShip.where({ closedAt: null })
		.where(row => row.remoteId.isNotNull())
		.orderBy(row => row.updatedAt.asc())
		.limit(opts.limit ?? 50)
		.all()) as ReviewShipRow[]

	for (const row of rows) {
		summary.checked += 1
		try {
			const status = await getReviewShip(row.externalId)
			if (!status || status.phase === "withdrawn" || status.phase === "reverted") {
				summary.missing += 1
				await db.orm.public.ReviewShip.where({ id: row.id }).update({
					closedAt: nowText(),
					lastError: status ? `Review reported this ship as ${status.phase}` : "Review no longer knows this ship",
					remoteId: null,
					status: status?.phase ?? "missing",
					version: null,
				})
				continue
			}
			summary.updated += 1
			await db.orm.public.ReviewShip.where({ id: row.id }).update({
				decision: status.decision,
				lastError: null,
				status: status.phase,
				version: status.version,
			})
		} catch (err) {
			summary.failed += 1
			const reason = err instanceof Error ? err.message : String(err)
			await db.orm.public.ReviewShip.where({ id: row.id }).update({ lastError: reason })
		}
	}

	return summary
}

/** The external id for a project phase, matching the one Half Life sends to Ari. */
export function reviewExternalId(themeProjectId: string, phase: Phase): string {
	return ariExternalId(themeProjectId, phase)
}

/** A helper for the admin page and tests: the current row, if any. */
export async function getReviewShipRow(themeProjectId: string, phase: Phase): Promise<ReviewShipRow | null> {
	const row = await db.orm.public.ReviewShip.where({ phase, themeProjectId }).first()
	return row
}
