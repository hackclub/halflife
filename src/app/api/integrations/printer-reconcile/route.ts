import type { NextRequest } from "next/server"
import { ok, withRoute } from "@/lib/api"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import { findPrinterAwardMismatches } from "@/lib/printer"
import { recordSyncRun } from "@/lib/sync-run-log"

/**
 * Reports awards whose holder no longer qualifies — never revokes. The printer
 * may already be in a box, so a human decides what happens next.
 */
export const POST = withRoute(async (req: NextRequest) => {
  const denied = requireIntegrationAuth(req)
  if (denied) return denied

  const mismatches = await findPrinterAwardMismatches()
  await recordSyncRun("printer_reconcile", { mismatches: mismatches.length })
  return ok({ mismatches })
})
