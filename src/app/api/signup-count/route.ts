/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import type { NextRequest } from "next/server"
import { fail, ok, rateLimitedInMemory, withRoute } from "@/lib/api"
import { clientIp } from "@/lib/client-ip"
import { countSignups } from "@/lib/site/signup-count"

export const dynamic = "force-dynamic"

/**
 * The landing page's sign-up counter, polled by the hero.
 *
 * Public and unauthenticated, because it is on the landing page – so it is rate-limited per IP. That matters more than it looks: the Airtable list is paginated, so behind this route is a walk of several pages costing several slots of the process-wide Airtable throttle. The limiter is per instance and coarse, but the count itself is cached for a minute (`signup-count.ts`), so a burst of visitors collapses to one walk.
 *
 * `count: null` means "no number right now" – Airtable is unconfigured or did not answer – and the client renders nothing for it. That is the same state as before the first fetch lands, so it needs no separate handling, and a 500 would be the wrong signal for a page decoration.
 *
 * It answers `{ count }` rather than a bare number, so the shape can grow (a delta, an updated-at) without the client having to tell one response kind from another by inspecting the body. A throttle is an ordinary `fail()`, which the client already ignores because it checks `res.ok`.
 */
export const GET = withRoute(async (req: NextRequest) => {
	if (rateLimitedInMemory(`signup-count:${clientIp(req.headers)}`, 30, 60_000))
		return fail("RATE_LIMITED", "Too many requests – try again in a minute")

	return ok({ count: await countSignups() })
})
