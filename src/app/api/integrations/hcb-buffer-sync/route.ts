import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { syncGrantReturnCoins } from "@/lib/grant-return-coins"
import { syncBufferTopUps } from "@/lib/hcb-buffer-topups"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"

/**
 * Records the buffer top-ups made on HCB into card grants, marks the grants handed back, and pays the coins those returns earn.
 *
 * Writes only what is new. `?dryRun=true` reports what it would record without writing. Run hourly by the `hcb-buffer-sync` job: it reads every card grant's disbursements in turn, and a return is paid on the first run after it lands on HCB.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	const buffer = await syncBufferTopUps({ dryRun })
	const coins = await syncGrantReturnCoins({ dryRun })
	return ok({ buffer, coins })
})
