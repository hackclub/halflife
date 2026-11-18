import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { syncBufferTopUps } from "@/lib/hcb-buffer-topups"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"

/**
 * Records the buffer top-ups made on HCB into card grants, so the reconciler can read a grant's original amount back out.
 *
 * Writes only the new top-ups it finds. `?dryRun=true` reports what it would record without writing. Run daily by the `hcb-buffer-sync` job, because it reads every card grant's disbursements in turn.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) =>
	ok(await syncBufferTopUps({ dryRun: wantsDryRun(req) })),
)
