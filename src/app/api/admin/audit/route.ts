import type { NextRequest } from "next/server"
import { z } from "zod"
import { AuditAction } from "@/app/generated/prisma/enums"
import { ok, parseQuery, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { Permission } from "@/lib/permissions"
import { listAuditLog } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({
	// An enum, not a free string: anything else used to reach Prisma and answer
	// a 500 instead of naming the bad parameter.
	action: z.enum(AuditAction).optional(),
	targetId: z.string().max(80).optional(),
})

export const GET = withRoute(async (req: NextRequest) => {
	const gate = await requirePermission(Permission.VIEW_AUDIT_LOG)
	if (gate.error) return gate.error

	const parsed = parseQuery(req, query)
	if (parsed.error) return parsed.error

	return ok(await listAuditLog(parsed.data))
})
