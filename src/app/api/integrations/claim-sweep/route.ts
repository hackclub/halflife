import type { NextRequest } from "next/server"
import { ok, withRoute } from "@/lib/api"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import prisma from "@/lib/prisma"
import { sweepExpiredClaims } from "@/lib/review"
import { recordSyncRun } from "@/lib/sync-run-log"

/**
 * The claim endpoint also clears an expired lock opportunistically, so this is a backstop for queues nobody has opened rather than the primary mechanism.
 */
export const POST = withRoute(async (req: NextRequest) => {
	const denied = requireIntegrationAuth(req)
	if (denied) return denied

	const dryRun = req.nextUrl.searchParams.get("dryRun") === "true"
	if (dryRun) {
		const expired = await prisma.reviewClaim.count({ where: { expiresAt: { lt: new Date() } } })
		return ok({ dryRun: true, expired })
	}

	const released = await sweepExpiredClaims()
	await recordSyncRun("claim_sweep", { released })
	return ok({ released })
})
