import type { NextRequest } from "next/server"
import { ok, parseQuery, withRoute } from "@/lib/api"
import { getBalances, getEarnedCredit, getLedgerPage } from "@/lib/currency"
import { requireSession } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

export const GET = withRoute(async (req: NextRequest) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const query = parseQuery(req, paginationQuery)
	if (query.error) return query.error

	const [balances, earned, page] = await Promise.all([
		prisma.$transaction(tx => getBalances(tx, gate.user.id)),
		prisma.$transaction(tx => getEarnedCredit(tx, gate.user.id)),
		getLedgerPage(gate.user.id, query.data.cursor, query.data.limit),
	])

	return ok({ ...balances, earned, items: page.items, nextCursor: page.nextCursor })
})
