import type { NextRequest } from "next/server"
import { z } from "zod"
import type { Prisma } from "@/app/generated/prisma/client"
import { ok, parseQuery, withRoute } from "@/lib/api"
import { getThemeDef } from "@/lib/config/program"
import { requireExportAuth } from "@/lib/integration-auth"
import { type CursorOrderOf, cursorWhere, orderByFor, pageResult, paginationQuery } from "@/lib/pagination"
import prisma from "@/lib/prisma"

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
} as const satisfies CursorOrderOf<{ createdAt: Date }, Prisma.UserOrderByWithRelationInput>

/**
 * Read-only participant export for the YSWS pipeline and sibling programs.
 *
 * `INTEGRATION_API_KEY` is the internal key and sees the full roster. The narrower `EXPORT_API_KEY` gets the same rows without the contact identifiers (email, Slack id), so a partner key is not a full PII dump.
 */
export const GET = withRoute(async (req: NextRequest) => {
	const gate = requireExportAuth(req)
	if ("denied" in gate) return gate.denied
	const internal = gate.scope === "internal"

	const parsed = parseQuery(req, query)
	if (parsed.error) return parsed.error

	const rows = await prisma.user.findMany({
		orderBy: orderByFor(PARTICIPANTS_ORDER),
		select: {
			createdAt: true,
			email: true,
			id: true,
			name: true,
			slackId: true,
			themeProjects: {
				select: {
					approvedHours: true,
					buildStatus: true,
					designStatus: true,
					githubRepo: true,
					grantUsd: true,
					theme: true,
					tier: true,
					title: true,
				},
				where: { deletedAt: null },
			},
			updatedAt: true,
			verificationStatus: true,
		},
		take: parsed.data.limit + 1,
		where: cursorWhere<Prisma.UserWhereInput>(
			parsed.data.cursor,
			PARTICIPANTS_ORDER,
			parsed.data.updatedSince ? { updatedAt: { gte: parsed.data.updatedSince } } : {},
		),
	})

	const page = pageResult(rows, parsed.data.limit, PARTICIPANTS_ORDER)
	return ok({
		items: page.items.map(u => ({
			createdAt: u.createdAt,
			id: u.id,
			name: u.name,
			updatedAt: u.updatedAt,
			verificationStatus: u.verificationStatus,
			...(internal ? { email: u.email, slackId: u.slackId } : {}),
			themeProjects: u.themeProjects.map(p => ({
				...p,
				themeLabel: getThemeDef(p.theme).label,
			})),
		})),
		nextCursor: page.nextCursor,
	})
})
