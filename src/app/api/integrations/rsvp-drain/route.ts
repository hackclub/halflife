import type { NextRequest } from "next/server"
import { drainRsvpBuffer } from "@/lib/airtable/rsvp"
import { ok, withRoute } from "@/lib/api"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

export const POST = withRoute(async (req: NextRequest) => {
	const denied = requireIntegrationAuth(req)
	if (denied) return denied

	const dryRun = req.nextUrl.searchParams.get("dryRun") === "true"
	const result = await drainRsvpBuffer(100, { dryRun })
	if (!dryRun && !result.skipped) await recordSyncRun("airtable_rsvp", { ...result })
	return ok({ dryRun, ...result })
})
