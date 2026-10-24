import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import db from "@/lib/prisma8"
import { sweepExpiredClaims } from "@/lib/review"
import { recordSyncRun } from "@/lib/sync-run-log"
import { formatDbTimestamp } from "@/lib/time"

/**
 * The claim endpoint also clears an expired lock opportunistically, so this is a backstop for queues nobody has opened rather than the primary mechanism.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	if (dryRun) {
		const { expired } = await db.orm.public.ReviewClaim.where(claim =>
			claim.expiresAt.lt(formatDbTimestamp(new Date())),
		).aggregate(a => ({ expired: a.count() }))
		return ok({ dryRun: true, expired })
	}

	const released = await sweepExpiredClaims()
	await recordSyncRun("claim_sweep", { released })
	return ok({ released })
})
