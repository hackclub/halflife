import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery, withRoute } from "@/lib/api"
import { getThemeDef } from "@/lib/config/program"
import { requireExportAuth } from "@/lib/integration-auth"
import { cursorArgs, pageResult, paginationQuery } from "@/lib/pagination"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({ updatedSince: z.coerce.date().optional() })

/**
 * Read-only participant export for the YSWS pipeline and sibling programs.
 *
 * `INTEGRATION_API_KEY` is the internal key and sees the full roster. The
 * narrower `EXPORT_API_KEY` gets the same rows without the contact
 * identifiers (email, Slack id), so a partner key is not a full PII dump.
 */
export const GET = withRoute(async (req: NextRequest) => {
	const gate = requireExportAuth(req)
	if ("denied" in gate) return gate.denied
	const internal = gate.scope === "internal"

	const parsed = parseQuery(req, query)
	if (parsed.error) return parsed.error

	const rows = await prisma.user.findMany({
		where: parsed.data.updatedSince ? { updatedAt: { gte: parsed.data.updatedSince } } : undefined,
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		...cursorArgs(parsed.data.cursor, parsed.data.limit),
		select: {
			id: true,
			email: true,
			name: true,
			slackId: true,
			verificationStatus: true,
			createdAt: true,
			updatedAt: true,
			themeProjects: {
				where: { deletedAt: null },
				select: {
					theme: true,
					title: true,
					githubRepo: true,
					designStatus: true,
					buildStatus: true,
					tier: true,
					grantUsd: true,
					approvedHours: true,
				},
			},
		},
	})

	const page = pageResult(rows, parsed.data.limit)
	return ok({
		items: page.items.map((u) => ({
			id: u.id,
			name: u.name,
			verificationStatus: u.verificationStatus,
			createdAt: u.createdAt,
			updatedAt: u.updatedAt,
			...(internal ? { email: u.email, slackId: u.slackId } : {}),
			themeProjects: u.themeProjects.map((p) => ({
				...p,
				themeLabel: getThemeDef(p.theme).label,
			})),
		})),
		nextCursor: page.nextCursor,
	})
})
