import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery } from "@/lib/api"
import { fulfillmentFiltersFrom, toFulfillmentJson } from "@/lib/fulfillment-sheet"
import { withPermission } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { Permission } from "@/lib/permissions"
import { listFulfillmentOrders } from "@/lib/queries/fulfillment"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({
	delivery: z.string().optional(),
	from: z.string().optional(),
	method: z.string().optional(),
	stage: z.string().optional(),
	to: z.string().optional(),
})

/** One page of the fulfilment sheet, with the same filters the page reads, as rows the client can draw. */
export const GET = withPermission(Permission.FULFILL_ORDERS, async (req: NextRequest) => {
	const parsed = parseQuery(req, query)
	if (parsed.error) return parsed.error

	const { cursor, limit, ...search } = parsed.data
	const page = await listFulfillmentOrders(fulfillmentFiltersFrom(search), { cursor, limit })
	return ok({ items: page.items.map(toFulfillmentJson), nextCursor: page.nextCursor })
})
