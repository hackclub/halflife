import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery } from "@/lib/api"
import { ShopOrderStatus } from "@/lib/enums"
import { withPermission } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { Permission } from "@/lib/permissions"
import { listOrders } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({ status: z.enum(ShopOrderStatus).optional() })

export const GET = withPermission(Permission.FULFILL_ORDERS, async (req: NextRequest) => {
	const parsed = parseQuery(req, query)
	if (parsed.error) return parsed.error

	return ok(await listOrders(parsed.data))
})
