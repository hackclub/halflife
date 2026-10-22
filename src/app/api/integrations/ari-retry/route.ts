import type { AriWebhookEvent } from "@hackclub/ari"
import type { NextRequest } from "next/server"
import { Prisma } from "@/app/generated/prisma/client"
import { Phase } from "@/app/generated/prisma/enums"
import { ok } from "@/lib/api"
import {
	applyStoredEvent,
	findUnsyncedAriSubmissions,
	isAriConfigured,
	reconcileAriDecisions,
	sendSubmissionToAri,
	withdrawSubmissionFromAri,
} from "@/lib/ari"
import { AuditAction } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import prisma from "@/lib/prisma"
import { trackSideEffect } from "@/lib/side-effects"
import { recordSyncRun } from "@/lib/sync-run-log"
import { DAY_MS } from "@/lib/time"

export const maxDuration = 300

/** A failed withdraw is replayed for a week, then left to a human. */
const WITHDRAW_REPLAY_WINDOW_MS = 7 * DAY_MS

function phaseOf(metadata: unknown): Phase | null {
	const phase = (metadata as { phase?: unknown } | null)?.phase
	return phase === Phase.DESIGN || phase === Phase.BUILD ? phase : null
}

/**
 * Replays hand-ins that never reached Ari – a send that failed, or one on a deployment whose Ari secrets were added after the submission. Reviewers work in Ari, so a ship that never arrived is a project nobody will review.
 *
 * It also reconciles the other direction: a decision Ari holds but the webhook never delivered. The webhook is fire-and-forget, so a delivery sent before the endpoint was registered – or during an outage – is simply gone, and the hand-in sits decided at Ari while Half Life still shows it pending. `reconcileAriDecisions` asks Ari for each open hand-in's standing decision and applies it; the pass is bounded and shuffled, so a steady state costs a couple of hundred reads an hour rather than an unbounded sweep and no hand-in is starved by the ones before it.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	const pending = await findUnsyncedAriSubmissions()

	if (dryRun) return ok({ dryRun: true, pending })

	let synced = 0
	let skipped = 0
	let failed = 0
	for (const item of pending) {
		const result = await trackSideEffect(
			"ari",
			{
				actorId: null,
				metadata: { phase: item.phase, retry: true },
				targetId: item.themeProjectId,
				targetType: "ThemeProject",
			},
			() => sendSubmissionToAri(item.themeProjectId, item.phase),
		)
		if (!result) failed++
		else if ("skipped" in result) skipped++
		else synced++
	}

	// Withdrawals have no row to list – the submission they belonged to was deleted on unsubmit – so a failure's only trace is its audit row. Replay the ones that no later success has resolved; `not_queued` is success (Ari had already decided or dropped it).
	let withdrawn = 0
	let withdrawFailed = 0
	if (isAriConfigured()) {
		const failures = await prisma.auditLog.findMany({
			orderBy: { createdAt: "desc" },
			select: { createdAt: true, metadata: true, targetId: true },
			take: 50,
			where: {
				action: AuditAction.ARI_SYNC_FAILURE,
				createdAt: { gte: new Date(Date.now() - WITHDRAW_REPLAY_WINDOW_MS) },
				metadata: { equals: true, path: ["withdrawn"] },
				targetId: { not: null },
			},
		})

		const attempted = new Set<string>()
		for (const failure of failures) {
			const phase = phaseOf(failure.metadata)
			const targetId = failure.targetId
			if (!phase || !targetId) continue
			const key = `${targetId}:${phase}`
			if (attempted.has(key)) continue
			attempted.add(key)

			const resolved = await prisma.auditLog.findFirst({
				select: { id: true },
				where: {
					action: AuditAction.ARI_SYNC_SUCCESS,
					createdAt: { gt: failure.createdAt },
					metadata: { equals: true, path: ["withdrawn"] },
					targetId,
				},
			})
			if (resolved) continue

			const result = await trackSideEffect(
				"ari",
				{ actorId: null, metadata: { phase, retry: true, withdrawn: true }, targetId, targetType: "ThemeProject" },
				() => withdrawSubmissionFromAri(targetId, phase),
			)
			if (result) withdrawn++
			else withdrawFailed++
		}
	}

	// Deferred decisions: a build approval that arrived before its design. The event is stored whole, not just an error, so applying it here is replaying the decision itself; the still-waiting ones stay for the next run.
	let deferred = 0
	let deferredFailed = 0
	if (isAriConfigured()) {
		const waiting = await prisma.ariWebhookDelivery.findMany({
			orderBy: { receivedAt: "asc" },
			select: { id: true, payload: true },
			take: 25,
			where: { appliedAt: null, payload: { not: Prisma.DbNull } },
		})
		for (const row of waiting)
			try {
				await applyStoredEvent(row.payload as unknown as AriWebhookEvent)
				await prisma.ariWebhookDelivery.update({ data: { appliedAt: new Date() }, where: { id: row.id } })
				deferred++
			} catch (err) {
				// Still waiting on the design: leave it for a later run rather than counting it failed.
				if (err instanceof HttpError && err.code === "DESIGN_NOT_APPROVED") continue
				deferredFailed++
			}
	}

	// Missed decisions: a delivery the webhook never received leaves a hand-in open here while Ari has decided it. Bounded and shuffled, so the job stays inside its timeout, no hand-in is starved, and a backlog clears over a few runs. Quiet – the maker was told by the webhook in the normal case, and a catch-up must not become a flood.
	let reconciled = 0
	let reconciledApplied = 0
	let reconciledReverted = 0
	if (isAriConfigured()) {
		const result = await reconcileAriDecisions({ commit: true, limit: 150 })
		reconciled = result.checked
		reconciledApplied = result.applied
		reconciledReverted = result.reverted
	}

	const summary = {
		attempted: pending.length,
		deferred,
		deferredFailed,
		failed,
		reconciled,
		reconciledApplied,
		reconciledReverted,
		skipped,
		synced,
		withdrawFailed,
		withdrawn,
	}
	await recordSyncRun("ari_ship", summary)
	return ok(summary)
})
