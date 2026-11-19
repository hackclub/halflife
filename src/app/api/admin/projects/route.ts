import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery } from "@/lib/api"
import { withPermission } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { Permission } from "@/lib/permissions"
import { projectAccessFor, projectFiltersFrom, toProjectRow } from "@/lib/project-directory"
import { listProjects } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({
	build: z.string().optional(),
	design: z.string().optional(),
	extended: z.string().optional(),
	q: z.string().trim().max(200).optional(),
	theme: z.string().optional(),
	tier: z.string().optional(),
	unstarted: z.string().optional(),
})

/** One page of the project list, with the same filters the page reads, as rows the client can draw. */
export const GET = withPermission(Permission.VIEW_USERS, async (req: NextRequest, { gate }) => {
	const parsed = parseQuery(req, query)
	if (parsed.error) return parsed.error

	const { cursor, limit, ...search } = parsed.data
	const { includePii } = projectAccessFor(gate.roles)
	const page = await listProjects({ ...projectFiltersFrom(search), cursor, limit }, { includePii })
	const now = new Date()
	return ok({ items: page.items.map(project => toProjectRow(project, now)), nextCursor: page.nextCursor })
})
