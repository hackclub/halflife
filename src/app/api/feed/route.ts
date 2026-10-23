/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery } from "@/lib/api"
import { getFeed } from "@/lib/feed"
import { withSession } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"

// Clamped rather than validated: a zone only has to be a string short enough to be worth passing on, and an unusable one falls back inside getFeed rather than failing the whole feed.
const feedQuery = paginationQuery.extend({ tz: z.string().max(64).optional() })

export const GET = withSession(async (req: NextRequest, { gate }) => {
	const parsed = parseQuery(req, feedQuery)
	if (parsed.error) return parsed.error

	// The viewer's IANA zone, for what counts as today; getFeed checks it.
	return ok(
		await getFeed(gate.user.id, { cursor: parsed.data.cursor, limit: parsed.data.limit, timeZone: parsed.data.tz }),
	)
})

export const dynamic = "force-dynamic"
