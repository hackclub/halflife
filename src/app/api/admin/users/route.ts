/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery } from "@/lib/api"
import { withPermission } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { hasRole, Permission, Role } from "@/lib/permissions"
import { listUsers } from "@/lib/queries/admin"

const query = paginationQuery.extend({ q: z.string().trim().max(200).optional() })

export const GET = withPermission(Permission.VIEW_USERS, async (req: NextRequest, { gate }) => {
	const parsed = parseQuery(req, query)
	if (parsed.error) return parsed.error

	const includePii = hasRole(gate.roles, Role.ADMIN) || hasRole(gate.roles, Role.AUDITOR)
	return ok(await listUsers(parsed.data, { includePii }))
})

export const dynamic = "force-dynamic"
