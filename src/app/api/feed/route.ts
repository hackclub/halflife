import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery, withRoute } from "@/lib/api"
import { getFeed } from "@/lib/feed"
import { requireSession } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"

export const dynamic = "force-dynamic"

// Clamped rather than validated: a zone only has to be a string short enough to be worth passing on, and an unusable one falls back inside getFeed rather than failing the whole feed.
const feedQuery = paginationQuery.extend({ tz: z.string().max(64).optional() })

export const GET = withRoute(async (req: NextRequest) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const parsed = parseQuery(req, feedQuery)
	if (parsed.error) return parsed.error

	// The viewer's IANA zone, for what counts as today; getFeed checks it.
	return ok(
		await getFeed(gate.user.id, { cursor: parsed.data.cursor, limit: parsed.data.limit, timeZone: parsed.data.tz }),
	)
})
