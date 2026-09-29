import type { NextRequest } from "next/server"
import { Phase } from "@/app/generated/prisma/enums"
import { ok, withRoute } from "@/lib/api"
import { findUnsyncedAriSubmissions, isAriConfigured, sendSubmissionToAri, withdrawSubmissionFromAri } from "@/lib/ari"
import { AuditAction } from "@/lib/audit"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import prisma from "@/lib/prisma"
import { trackSideEffect } from "@/lib/side-effects"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

/** A failed withdraw is replayed for a week, then left to a human. */
const WITHDRAW_REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function phaseOf(metadata: unknown): Phase | null {
  const phase = (metadata as { phase?: unknown } | null)?.phase
  return phase === Phase.DESIGN || phase === Phase.BUILD ? phase : null
}

/**
 * Replays hand-ins that never reached Ari — a send that failed, or one on a
 * deployment whose Ari secrets were added after the submission. Reviewers work
 * in Ari, so a ship that never arrived is a project nobody will review.
 */
export const POST = withRoute(async (req: NextRequest) => {
  const denied = requireIntegrationAuth(req)
  if (denied) return denied

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "true"
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
        targetType: "ThemeProject",
        targetId: item.themeProjectId,
        metadata: { phase: item.phase, retry: true },
      },
      () => sendSubmissionToAri(item.themeProjectId, item.phase),
    )
    if (!result) failed++
    else if ("skipped" in result) skipped++
    else synced++
  }

  // Withdrawals have no row to list — the submission they belonged to was
  // deleted on unsubmit — so a failure's only trace is its audit row. Replay
  // the ones that no later success has resolved; `not_queued` is success
  // (Ari had already decided or dropped it).
  let withdrawn = 0
  let withdrawFailed = 0
  if (isAriConfigured()) {
    const failures = await prisma.auditLog.findMany({
      where: {
        action: AuditAction.ARI_SYNC_FAILURE,
        targetId: { not: null },
        createdAt: { gte: new Date(Date.now() - WITHDRAW_REPLAY_WINDOW_MS) },
        metadata: { path: ["withdrawn"], equals: true },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { targetId: true, metadata: true, createdAt: true },
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
        where: {
          action: AuditAction.ARI_SYNC_SUCCESS,
          targetId,
          createdAt: { gt: failure.createdAt },
          metadata: { path: ["withdrawn"], equals: true },
        },
        select: { id: true },
      })
      if (resolved) continue

      const result = await trackSideEffect(
        "ari",
        { actorId: null, targetType: "ThemeProject", targetId, metadata: { phase, withdrawn: true, retry: true } },
        () => withdrawSubmissionFromAri(targetId, phase),
      )
      if (result) withdrawn++
      else withdrawFailed++
    }
  }

  const summary = { attempted: pending.length, synced, skipped, failed, withdrawn, withdrawFailed }
  await recordSyncRun("ari_ship", summary)
  return ok(summary)
})
