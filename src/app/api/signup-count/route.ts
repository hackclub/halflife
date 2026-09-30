import type { NextRequest } from "next/server"
import { ok, rateLimitedInMemory, withRoute } from "@/lib/api"
import { clientIp } from "@/lib/site/signups"
import { countAccounts } from "@/lib/site/signup-count"

export const dynamic = "force-dynamic"

/**
 * The landing page's sign-up counter, polled by the hero.
 *
 * Public and unauthenticated, because it is on the landing page — so it is
 * rate-limited per IP (`rateLimitedInMemory` is per instance and coarse, which
 * is the right size for a number that is not secret) and it counts rather than
 * reading rows, since anyone can call it in a loop.
 *
 * It answers `{ count }` rather than a bare number, so the shape can grow
 * (a delta, an updated-at) without the client having to tell one response kind
 * from another by inspecting the body.
 */
export const GET = withRoute(async (req: NextRequest) => {
  if (rateLimitedInMemory(`signup-count:${clientIp(req.headers)}`, 30, 60_000)) {
    return ok({ count: null }, { status: 429 })
  }
  return ok({ count: await countAccounts() })
})
