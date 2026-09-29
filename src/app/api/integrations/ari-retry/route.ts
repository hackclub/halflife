import type { NextRequest } from "next/server"
import { ok, withRoute } from "@/lib/api"
import { findUnsyncedAriSubmissions, sendSubmissionToAri } from "@/lib/ari"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import { trackSideEffect } from "@/lib/side-effects"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

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

  const summary = { attempted: pending.length, synced, skipped, failed }
  await recordSyncRun("ari_ship", summary)
  return ok(summary)
})
