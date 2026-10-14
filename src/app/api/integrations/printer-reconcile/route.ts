import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import { findPrinterAwardMismatches } from "@/lib/printer"
import { recordSyncRun } from "@/lib/sync-run-log"

/**
 * Reports awards whose holder no longer qualifies – never revokes. The printer may already be in a box, so a human decides what happens next.
 *
 * `?dryRun=true` returns the mismatches without writing the run record, which is the only thing here that writes. This was the one integration route without the parameter the others all take.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	const mismatches = await findPrinterAwardMismatches()
	if (!dryRun) await recordSyncRun("printer_reconcile", { mismatches: mismatches.length })
	return ok({ dryRun, mismatches })
})
