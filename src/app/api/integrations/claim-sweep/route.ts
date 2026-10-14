import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import prisma from "@/lib/prisma"
import { sweepExpiredClaims } from "@/lib/review"
import { recordSyncRun } from "@/lib/sync-run-log"

/**
 * The claim endpoint also clears an expired lock opportunistically, so this is a backstop for queues nobody has opened rather than the primary mechanism.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	if (dryRun) {
		const expired = await prisma.reviewClaim.count({ where: { expiresAt: { lt: new Date() } } })
		return ok({ dryRun: true, expired })
	}

	const released = await sweepExpiredClaims()
	await recordSyncRun("claim_sweep", { released })
	return ok({ released })
})
