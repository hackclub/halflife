import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery } from "@/lib/api"
import { toDirectoryRows } from "@/lib/directory-rows"
import { withPermission } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { hasRole, Permission, Role } from "@/lib/permissions"
import { listUsers, USER_STATES } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({
	q: z.string().trim().max(200).optional(),
	state: z.enum(USER_STATES).optional(),
	verified: z.string().trim().max(50).optional(),
})

/** One page of the directory as rows the client can draw, with the cursor for the next page. */
export const GET = withPermission(Permission.VIEW_USERS, async (req: NextRequest, { gate }) => {
	const parsed = parseQuery(req, query)
	if (parsed.error) return parsed.error

	const includePii = hasRole(gate.roles, Role.ADMIN) || hasRole(gate.roles, Role.AUDITOR)
	const page = await listUsers(parsed.data, { includePii })
	return ok({ items: await toDirectoryRows(page.items, includePii), nextCursor: page.nextCursor })
})
