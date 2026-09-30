import type { NextRequest } from "next/server"
import { z } from "zod"
import { ShopOrderStatus } from "@/app/generated/prisma/enums"
import { ok, parseQuery, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { Permission } from "@/lib/permissions"
import { listOrders } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({ status: z.enum(ShopOrderStatus).optional() })

export const GET = withRoute(async (req: NextRequest) => {
  const gate = await requirePermission(Permission.FULFILL_ORDERS)
  if (gate.error) return gate.error

  const parsed = parseQuery(req, query)
  if (parsed.error) return parsed.error

  return ok(await listOrders(parsed.data))
})
