import type { NextRequest } from "next/server"
import { z } from "zod"
import { AuditAction } from "@/app/generated/prisma/enums"
import { ok, parseQuery } from "@/lib/api"
import { withPermission } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { Permission } from "@/lib/permissions"
import { listAuditLog } from "@/lib/queries/admin"
import { parseDbTimestamp } from "@/lib/time"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({
	// An enum, not a free string: anything else used to reach Prisma and answer a 500 instead of naming the bad parameter.
	action: z.enum(AuditAction).optional(),
	targetId: z.string().max(80).optional(),
})

export const GET = withPermission(Permission.VIEW_AUDIT_LOG, async (req: NextRequest) => {
	const parsed = parseQuery(req, query)
	if (parsed.error) return parsed.error

	const { items, nextCursor } = await listAuditLog(parsed.data)
	// Prisma 8 returns the column as PostgreSQL text; keep the API's dates in the ISO form JSON had before.
	return ok({ items: items.map(entry => ({ ...entry, createdAt: parseDbTimestamp(entry.createdAt).toISOString() })), nextCursor })
})
