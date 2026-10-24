import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery } from "@/lib/api"
import { getThemeDef } from "@/lib/config/program"
import { withExportRoute } from "@/lib/integration-route"
import { type CursorOrderOf, pageResult, paginationQuery, readCursor } from "@/lib/pagination"
import db from "@/lib/prisma8"
import { withFields } from "@/lib/rows"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({ updatedSince: z.coerce.date().optional() })

/**
 * The export's order: oldest participant first, with the id as the tiebreaker.
 *
 * The cursor carries both halves of that position, so a page boundary never drops a participant or hands one out twice.
 */
const PARTICIPANTS_ORDER = {
	at: (row: { createdAt: Date }) => row.createdAt,
	column: "createdAt",
	direction: "asc",
} as const satisfies CursorOrderOf<{ createdAt: Date }>

/**
 * Read-only participant export for the YSWS pipeline and sibling programs.
 *
 * `INTEGRATION_API_KEY` is the internal key and sees the full roster. The narrower `EXPORT_API_KEY` gets the same rows without the contact identifiers (email, Slack id), so a partner key is not a full PII dump.
 */
export const GET = withExportRoute(async (req: NextRequest, gate) => {
	const internal = gate.scope === "internal"

	const parsed = parseQuery(req, query)
	if (parsed.error) return parsed.error
	const { data } = parsed

	const { cursor, updatedSince } = data
	const position = readCursor(cursor)
	const ordered = db.orm.public.User.orderBy([user => user.createdAt.asc(), user => user.id.asc()])
	const filtered = updatedSince ? ordered.where(user => user.updatedAt.gte(formatDbTimestamp(updatedSince))) : ordered
	const paged =
		position?.at === undefined || position.at === null
			? filtered
			: filtered.cursor({ createdAt: formatDbTimestamp(position.at), id: position.id })

	const rows = await paged
		.select("createdAt", "email", "id", "name", "slackId", "updatedAt", "verificationStatus")
		.include("themeProjects", projects =>
			projects
				.where({ deletedAt: null })
				.select("approvedHours", "buildStatus", "designStatus", "githubRepo", "grantUsd", "theme", "tier", "title"),
		)
		.limit(data.limit + 1)
		.all()

	// The cursor is a position, and a Prisma 8 timestamp is text: the cursor needs the text form back and the response keeps the ISO dates JSON always had.
	const page = pageResult(
		rows.map(row =>
			withFields(row, {
				createdAt: parseDbTimestamp(row.createdAt),
				updatedAt: parseDbTimestamp(row.updatedAt),
			}),
		),
		data.limit,
		PARTICIPANTS_ORDER,
	)
	return ok({
		items: page.items.map(u => ({
			createdAt: u.createdAt,
			id: u.id,
			name: u.name,
			themeProjects: u.themeProjects.map(p => withFields(p, { themeLabel: getThemeDef(p.theme).label })),
			updatedAt: u.updatedAt,
			verificationStatus: u.verificationStatus,
			...(internal ? { email: u.email, slackId: u.slackId } : {}),
		})),
		nextCursor: page.nextCursor,
	})
})
