import "server-only"
import type { AriReview, AriWebhookEvent } from "@hackclub/ari"
import { mirrorAriPhaseToYsws, mirrorReviewDecision, reviewStatusFor, reviewStatusForResult } from "@/lib/airtable/sync"
import { approvedHoursFrom } from "@/lib/ari-hours"
import { parseAriExternalId } from "@/lib/ari-id"
import { AuditAction, logAudit } from "@/lib/audit"
import { isTierId, tierForHours } from "@/lib/config/tiers"
import { Phase, PhaseStatus, ReviewResult, Theme } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { getIreShip, type IreShipStatus, isIreConfigured } from "@/lib/ire-platform"
import { notifyReviewOutcome } from "@/lib/notifications"
import { phaseStatusUpdate, statusFor } from "@/lib/phase"
import db from "@/lib/prisma8"
import { finalizeReview, reopenPhase, unapprovePhase } from "@/lib/review"
import { formatDbTimestamp } from "@/lib/time"

/**
 * Ire's live decision path.
 *
 * Mirrors the Ari inbound logic (`src/lib/ari.ts`) but resolves the local
 * hand-in through the `IreShip` row (keyed by `(themeProjectId, phase)`,
 * which survives unsubmit) instead of `PhaseSubmission.ariSubmissionId`.
 * For the transition the decision is also mirrored into the `ari*` columns
 * on `PhaseSubmission` so existing admin counts, Airtable mirrors and audit
 * queries keep working until those columns are renamed.
 */

export function defaultIreFeedback(result: ReviewResult): string {
	if (result === ReviewResult.APPROVED) return "Approved by Ire."
	if (result === ReviewResult.RETURNED) return "Ire asked for changes before this can be approved."
	return "Ire rejected this submission."
}

function ireReviewerLabel(review: AriReview): string {
	return review.reviewer?.email ?? "Ire"
}

async function ignored(event: { event: string }, reason: string, externalId: string | null): Promise<void> {
	await logAudit({
		action: AuditAction.ARI_WEBHOOK_IGNORED,
		metadata: { event: event.event, externalId, provider: "ire", reason },
		targetId: externalId ? (parseAriExternalId(externalId)?.themeProjectId ?? null) : null,
		targetType: "ThemeProject",
	})
}

async function recordIrePhase(
	themeProjectId: string,
	phase: Phase,
	irePhase: string,
	submissionId: string | null,
): Promise<void> {
	const at = new Date()
	const atText = formatDbTimestamp(at)
	if (submissionId)
		try {
			await db.orm.public.PhaseSubmission.where({ id: submissionId }).update({
				ariStatus: irePhase,
				ariStatusAt: atText,
			})
		} catch (err) {
			console.error(`[ire] could not record the phase ${irePhase} for ${themeProjectId}:${phase}:`, err)
		}
	try {
		const row = await db.orm.public.IreShip.where({ phase, themeProjectId }).select("id").first()
		if (row) await db.orm.public.IreShip.where({ id: row.id }).update({ status: irePhase, syncedAt: atText })
	} catch (err) {
		console.error(`[ire] could not record the ship phase ${irePhase} for ${themeProjectId}:${phase}:`, err)
	}
	await mirrorAriPhaseToYsws(themeProjectId, phase, irePhase, at)
}

type DecisionEvent = Extract<AriWebhookEvent, { event: "review.approved" | "review.changes" | "review.rejected" }>
type FraudEvent = Extract<AriWebhookEvent, { event: "review.fraud" }>
type UpdatedEvent = Extract<AriWebhookEvent, { event: "ship.updated" }>
type UnknownEvent = Extract<AriWebhookEvent, { event: "unknown" }>

async function applyDecision(event: DecisionEvent, opts: { announce?: boolean } = {}): Promise<void> {
	const parsed = parseAriExternalId(event.external_id)
	if (!parsed) {
		await ignored(event, "unparseable external_id", event.external_id)
		return
	}
	const { themeProjectId, phase } = parsed

	// Prefer the row this ship was actually sent for. A withdraw-and-resubmit reuses the same external id, so a decision for the withdrawn ship must not be applied to the newer hand-in.
	const shipRow = await db.orm.public.IreShip.where({ phase, themeProjectId })
		.select("lastSubmissionId", "remoteId")
		.first()
	const open = shipRow?.lastSubmissionId
		? await db.orm.public.PhaseSubmission.where({ id: shipRow.lastSubmissionId })
				.select("ariStatus", "id", "resolvedAt")
				.first()
		: null
	const fallback = await db.orm.public.PhaseSubmission.where({ phase, resolvedAt: null, themeProjectId })
		.orderBy(sub => sub.createdAt.desc())
		.select("ariStatus", "id", "resolvedAt")
		.first()
	const submission = open ?? fallback
	if (!submission) {
		await ignored(event, "no open submission for this phase", event.external_id)
		return
	}
	if (shipRow?.remoteId && shipRow.remoteId !== event.id) {
		await ignored(event, "decision names an earlier ship of this phase", event.external_id)
		return
	}

	const result =
		event.event === "review.approved"
			? ReviewResult.APPROVED
			: event.event === "review.changes"
				? ReviewResult.RETURNED
				: ReviewResult.REJECTED

	let tier: number | null = null
	let grantUsdOverride: number | null = null
	if (result === ReviewResult.APPROVED && phase === Phase.DESIGN) {
		const project = await db.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
			.select("requestedTier", "tier")
			.first()
		const chosen = project?.requestedTier ?? project?.tier ?? null
		if (!chosen || !isTierId(chosen)) {
			await ignored(event, "design approved but no valid funding tier is set", event.external_id)
			return
		}
		tier = chosen
		const approved = approvedHoursFrom(event.review)
		if (approved !== null) {
			const affordable = tierForHours(approved)
			if (affordable) {
				if (affordable.id < chosen) tier = affordable.id
			} else grantUsdOverride = 0
		}
	}

	if (result === ReviewResult.APPROVED && phase === Phase.BUILD) {
		const project = await db.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
			.select("designStatus", "theme")
			.first()
		if (project?.theme !== Theme.WARMUP && project?.designStatus !== PhaseStatus.approved)
			throw new HttpError(
				"DESIGN_NOT_APPROVED",
				"Waiting for the design approval before this build approval can be applied",
			)
	}

	await db.orm.public.ReviewClaim.where({ submissionId: submission.id }).deleteAndCount()

	const feedback = event.review.note_to_maker?.trim() || defaultIreFeedback(result)
	const makerNote = event.review.note_to_maker?.trim() || null
	const technicalFeatures = event.review.justification?.technical_features?.trim() || null

	try {
		await finalizeReview({
			feedback,
			grantExtension: opts.announce !== false,
			grantUsdOverride,
			hoursOverride: approvedHoursFrom(event.review),
			reason: event.review.audit_note ?? null,
			result,
			reviewerEmail: event.review.reviewer?.email ?? null,
			reviewerId: null,
			reviewerName: ireReviewerLabel(event.review),
			submissionId: submission.id,
			technicalFeatures,
			tier,
		})
	} catch (err) {
		if (err instanceof HttpError && (err.code === "ALREADY_RESOLVED" || err.code === "NOT_SUBMITTED")) {
			await ignored(event, err.code.toLowerCase(), event.external_id)
			return
		}
		throw err
	}

	const nowText = formatDbTimestamp(new Date())
	await db.orm.public.PhaseSubmission.where({ id: submission.id }).update({
		ariDecision: event.decision,
		ariStatus: "reviewed",
		ariSubmissionId: event.id,
	})
	try {
		const row = await db.orm.public.IreShip.where({ phase, themeProjectId }).select("id").first()
		if (row)
			await db.orm.public.IreShip.where({ id: row.id }).update({
				closedAt: nowText,
				decision: event.decision,
				lastError: null,
				status: "reviewed",
				syncedAt: nowText,
			})
	} catch (err) {
		console.error(`[ire] could not close the ship for ${themeProjectId}:${phase}:`, err)
	}

	await recordIrePhase(themeProjectId, phase, "reviewed", submission.id)

	await logAudit({
		action: AuditAction.ARI_WEBHOOK_APPLIED,
		metadata: {
			approvedHours: approvedHoursFrom(event.review),
			decision: event.decision,
			event: event.event,
			ireSubmissionId: event.id,
			phase,
			provider: "ire",
			reviewer: event.review.reviewer?.email ?? null,
		},
		targetId: themeProjectId,
		targetType: "ThemeProject",
	})

	if (opts.announce !== false)
		await mirrorReviewDecision(
			themeProjectId,
			phase,
			reviewStatusForResult(result),
			makerNote,
			event.review.reviewer?.email ?? null,
			event.review.justification?.deflation_reason ?? null,
			event.review.audit_note?.trim() || null,
		)

	if (opts.announce !== false)
		await notifyReviewOutcome({
			decidedBy: "ire",
			note: makerNote,
			phase,
			result,
			themeProjectId,
		})
}

interface ResetInput {
	event: "review.reverted" | "review.requeued"
	external_id: string
	id: string
}

async function applyReset(event: ResetInput): Promise<void> {
	const parsed = parseAriExternalId(event.external_id)
	if (!parsed) {
		await ignored(event, "unparseable external_id", event.external_id)
		return
	}
	const { themeProjectId, phase } = parsed

	const project = await db.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
		.select("buildStatus", "designStatus")
		.first()
	if (!project) {
		await ignored(event, "project not found", event.external_id)
		return
	}

	const shipRow = await db.orm.public.IreShip.where({ phase, themeProjectId }).select("id", "remoteId").first()
	const latest = await db.orm.public.PhaseSubmission.where({ phase, themeProjectId })
		.orderBy(submission => submission.createdAt.desc())
		.select("ariStatus", "id")
		.first()
	if (!latest) {
		await ignored(event, "no submission to requeue", event.external_id)
		return
	}
	if (shipRow?.remoteId && shipRow.remoteId !== event.id) {
		await ignored(event, "reset names an earlier ship of this phase", event.external_id)
		return
	}

	const status = statusFor(project, phase)
	const reason = `Ire ${event.event === "review.requeued" ? "requeued" : "reverted"} the review`
	if (status === PhaseStatus.approved) await unapprovePhase(themeProjectId, phase, null, null, reason)
	else if (status === PhaseStatus.rejected) await reopenPhase(themeProjectId, phase, null, null, reason)

	const nextStatus = event.event === "review.reverted" ? PhaseStatus.update_requested : PhaseStatus.in_review
	const ireStatus = event.event === "review.reverted" ? "reverted" : "review"
	const nowText = formatDbTimestamp(new Date())
	await db.transaction(async tx => {
		await tx.orm.public.SubmissionReview.where({ invalidated: false })
			.where(review =>
				review.submission.some(
					submission => submission.phase.eq(phase) && submission.themeProjectId.eq(themeProjectId),
				),
			)
			.updateAndCount({ invalidated: true, invalidatedAt: nowText })
		await tx.orm.public.PhaseSubmission.where({ id: latest.id }).update({
			ariDecision: null,
			ariStatus: ireStatus,
			resolvedAt: null,
			resolvedResult: null,
		})
		await tx.orm.public.ThemeProject.where({ id: themeProjectId }).update(phaseStatusUpdate(phase, nextStatus))
	})

	if (shipRow)
		await db.orm.public.IreShip.where({ id: shipRow.id }).update({
			closedAt: event.event === "review.reverted" ? nowText : null,
			decision: null,
			lastError: null,
			status: ireStatus,
			syncedAt: nowText,
		})

	await logAudit({
		action: AuditAction.ARI_WEBHOOK_APPLIED,
		metadata: { event: event.event, phase, provider: "ire", undone: status },
		targetId: themeProjectId,
		targetType: "ThemeProject",
	})

	await recordIrePhase(themeProjectId, phase, ireStatus, latest.id)
	await mirrorReviewDecision(themeProjectId, phase, reviewStatusFor(nextStatus), null, null, null, null)
}

async function applyFraud(event: FraudEvent): Promise<void> {
	const parsed = parseAriExternalId(event.external_id)
	let userId: string | null = null
	if (parsed) {
		const project = await db.orm.public.ThemeProject.whereUnique({ id: parsed.themeProjectId }).select("userId").first()
		userId = project?.userId ?? null
	}

	if (event.fraud.verdict === "failed" && userId)
		await db.orm.public.User.where({ id: userId }).update({ fraudFlagged: true })

	await logAudit({
		action: AuditAction.ARI_WEBHOOK_APPLIED,
		metadata: {
			checks: event.fraud.checks.length,
			event: event.event,
			flagged: event.fraud.verdict === "failed",
			provider: "ire",
			verdict: event.fraud.verdict,
		},
		targetId: parsed?.themeProjectId ?? null,
		targetType: "ThemeProject",
	})
}

async function applyShipUpdated(event: UpdatedEvent): Promise<void> {
	await logAudit({
		action: AuditAction.ARI_WEBHOOK_IGNORED,
		metadata: {
			changes: event.changes.map(change => ({
				field: change.field,
				new_value: change.new_value,
				old_value: change.old_value,
			})),
			editedBy: event.edited_by?.email ?? null,
			event: event.event,
			provider: "ire",
		},
		targetId: parseAriExternalId(event.external_id)?.themeProjectId ?? null,
		targetType: "ThemeProject",
	})
}

async function applyUnknown(event: UnknownEvent): Promise<void> {
	await logAudit({
		action: AuditAction.ARI_WEBHOOK_IGNORED,
		metadata: { event: event.event, eventName: event.event_name, provider: "ire" },
	})
}

async function applyEvent(event: AriWebhookEvent): Promise<void> {
	switch (event.event) {
		case "review.approved":
		case "review.changes":
		case "review.rejected":
			await applyDecision(event)
			break
		case "review.reverted":
		case "review.requeued":
			await applyReset(event)
			break
		case "review.fraud":
			await applyFraud(event)
			break
		case "ship.updated":
			await applyShipUpdated(event)
			break
		case "unknown":
			await applyUnknown(event)
			break
	}
}

/** Apply an Ire event stored while the state was not ready for it. Called by the retry job. */
export async function applyStoredIreEvent(event: AriWebhookEvent): Promise<void> {
	await applyEvent(event)
}

/**
 * Apply one verified Ire webhook delivery.
 *
 * Idempotent: the delivery id is checked first and recorded only after the
 * work succeeds, so a redelivery (same id) is a no-op. A decision the state
 * is not ready for (build approved before its design) is rethrown so Ire
 * redelivers it; the hourly reconcile pass also picks it up once the design
 * lands, so nothing depends on Ire's redelivery window outlasting the wait.
 * Deferred deliveries are deliberately NOT stored: unlike the Ari path,
 * this table is shared and has no provider column, so a stored Ire event
 * would be replayed by `ari-retry` through the wrong decision path.
 *
 * Errors are rethrown so the route answers non-2xx.
 */
export async function applyIreWebhook(event: AriWebhookEvent, deliveryId: string): Promise<void> {
	const seen = await db.orm.public.AriWebhookDelivery.where({ deliveryId }).select("id").first()
	if (seen) return

	const externalId = "external_id" in event ? event.external_id : null
	const ireSubmissionId = "id" in event ? event.id : null

	try {
		await applyEvent(event)
	} catch (err) {
		if (err instanceof HttpError && err.code === "DESIGN_NOT_APPROVED")
			await logAudit({
				action: AuditAction.ARI_WEBHOOK_IGNORED,
				metadata: {
					deferred: true,
					event: event.event,
					externalId,
					provider: "ire",
					reason: "deferred: design not approved",
				},
				targetId: externalId ? (parseAriExternalId(externalId)?.themeProjectId ?? null) : null,
				targetType: "ThemeProject",
			})
		throw err
	}

	await db.orm.public.AriWebhookDelivery.create({
		ariSubmissionId: typeof ireSubmissionId === "string" ? ireSubmissionId : null,
		deliveryId,
		event: event.event,
		externalId,
	})
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

/** What a reconcile pass did. */
export interface IreReconcileSummary {
	applied: number
	checked: number
	decided: number
	deferred: number
	failed: number
	missing: number
	pending: number
	phaseUpdated: number
	reverted: number
	skipped: number
}

function syntheticDecision(
	decision: "approved" | "changes" | "rejected",
	externalId: string,
	id: string,
): DecisionEvent {
	const maker = { email: "", name: "", slack_id: null }
	// A status poll carries the decision but no review, so the decision is
	// recorded with the generic sentence – the same recovery shape as Ari's
	// `decisionEventFromStatus`. A later webhook delivery carrying the
	// reviewer's words still lands through the normal path.
	const review = { note_to_maker: "", reviewer: null }
	const ship = {
		authors: [],
		demo_url: null,
		description: null,
		hackatime_projects: [],
		repo_url: "",
		thumbnail_url: null,
		title: "",
		track: "hardware" as const,
	}
	if (decision === "approved")
		return { decision, event: "review.approved", external_id: externalId, id, maker, review, ship }
	if (decision === "changes")
		return { decision, event: "review.changes", external_id: externalId, id, maker, review, ship }
	return { decision, event: "review.rejected", external_id: externalId, id, maker, review, ship }
}

/**
 * Replay decisions Ire holds but the webhook never delivered.
 *
 * The live-mode counterpart of `reconcileAriDecisions` and the safety net
 * for deferred builds: the webhook is fire-and-forget, so a delivery sent
 * while the endpoint was unregistered or unreachable is gone, while the
 * ship still carries its result. Candidates are the open `IreShip` rows
 * whose local phase is still in review; a capped run takes only the first
 * `limit` of them in shuffled order so no ship starves behind the others.
 * Quiet by default – a catch-up run must not become a flood of late DMs.
 */
export async function reconcileIreDecisions(
	opts: { announce?: boolean; commit?: boolean; limit?: number } = {},
): Promise<IreReconcileSummary> {
	const summary: IreReconcileSummary = {
		applied: 0,
		checked: 0,
		decided: 0,
		deferred: 0,
		failed: 0,
		missing: 0,
		pending: 0,
		phaseUpdated: 0,
		reverted: 0,
		skipped: 0,
	}
	if (!isIreConfigured()) return summary

	const rows = await db.orm.public.IreShip.where({ closedAt: null })
		.where(row => row.remoteId.isNotNull())
		.orderBy(row => row.updatedAt.asc())
		.include("themeProject", project => project.select("buildStatus", "deletedAt", "designStatus"))
		.limit(opts.limit ?? 2000)
		.all()
	const open = rows
		.filter(row => {
			const project = row.themeProject
			return project && project.deletedAt === null && statusFor(project, row.phase) === PhaseStatus.in_review
		})
		.map(value => ({ order: Math.random(), value }))
		.toSorted((a, b) => a.order - b.order)
		.slice(0, opts.limit ?? 2000)
		.map(entry => entry.value)

	for (const row of open) {
		summary.checked += 1
		let status: IreShipStatus | null
		try {
			status = await getIreShip(row.externalId)
		} catch (err) {
			summary.failed += 1
			console.error(`[ire] reconcile: status failed for ${row.themeProjectId}:${row.phase}`, err)
			continue
		}

		if (!status || status.phase === "withdrawn") {
			summary.missing += 1
			if (opts.commit)
				await db.orm.public.IreShip.where({ id: row.id }).update({
					closedAt: formatDbTimestamp(new Date()),
					lastError: status ? `Ire reported this ship as ${status.phase}` : "Ire no longer knows this ship",
					remoteId: null,
					status: status?.phase ?? "missing",
					version: null,
				})
			continue
		}

		// Only the ship this row was sent as says anything about its phase.
		if (row.remoteId === status.id && opts.commit) {
			const current = (await db.orm.public.IreShip.where({ id: row.id }).select("status").first())?.status ?? null
			if (current !== status.phase) {
				await db.orm.public.IreShip.where({ id: row.id }).update({
					decision: status.decision,
					lastError: null,
					status: status.phase,
					syncedAt: formatDbTimestamp(new Date()),
					version: status.version,
				})
				summary.phaseUpdated += 1
			}
		}

		if (status.phase === "reverted") {
			summary.reverted += 1
			if (row.remoteId !== status.id) {
				summary.skipped += 1
				continue
			}
			if (!opts.commit) continue
			try {
				await applyReset({ event: "review.reverted", external_id: status.externalId, id: status.id })
				summary.applied += 1
			} catch (err) {
				summary.failed += 1
				console.error(`[ire] reconcile: could not apply the revert for ${row.themeProjectId}:${row.phase}`, err)
			}
			continue
		}

		if (status.phase !== "reviewed" || !status.decision) {
			summary.pending += 1
			continue
		}
		if (status.decision !== "approved" && status.decision !== "changes" && status.decision !== "rejected") {
			summary.pending += 1
			continue
		}
		summary.decided += 1
		if (!opts.commit) continue

		if (row.remoteId !== status.id) {
			summary.skipped += 1
			continue
		}

		try {
			await applyDecision(syntheticDecision(status.decision, status.externalId, status.id), {
				announce: opts.announce === true,
			})
			summary.applied += 1
		} catch (err) {
			if (err instanceof HttpError && err.code === "DESIGN_NOT_APPROVED") {
				summary.deferred += 1
				continue
			}
			summary.failed += 1
			console.error(`[ire] reconcile: could not apply ${status.decision} for ${row.themeProjectId}:${row.phase}`, err)
		}
	}

	return summary
}
