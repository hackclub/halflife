import type { NextRequest } from "next/server"
import { ok, withRoute } from "@/lib/api"
import { refreshLinkCache } from "@/lib/hackatime"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import prisma from "@/lib/prisma"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

/**
 * Every integration route takes `?dryRun=true` and returns what it would have
 * done without writing. This is the single thing that makes scheduled work
 * debuggable in production.
 */
export const POST = withRoute(async (req: NextRequest) => {
  const denied = requireIntegrationAuth(req)
  if (denied) return denied

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "true"
  const started = Date.now()

  const links = await prisma.hackatimeLink.findMany({
    where: { hoursApproved: null },
    select: { id: true },
  })

  if (dryRun) {
    return ok({ dryRun: true, scanned: links.length, updated: 0, failed: 0 })
  }

  let updated = 0
  let failed = 0
  for (const link of links) {
    const result = await refreshLinkCache(link.id)
    if (result.stale) failed++
    else updated++
  }

  const summary = { scanned: links.length, updated, failed, durationMs: Date.now() - started }
  await recordSyncRun("hackatime", summary)
  return ok(summary)
})
