import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { Permission } from "@/lib/permissions"
import { listAuditLog } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({
  action: z.string().max(80).optional(),
  targetId: z.string().max(80).optional(),
})

export const GET = withRoute(async (req: NextRequest) => {
  const gate = await requirePermission(Permission.VIEW_AUDIT_LOG)
  if (gate.error) return gate.error

  const parsed = parseQuery(req, query)
  if (parsed.error) return parsed.error

  return ok(await listAuditLog(parsed.data))
})
