/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import type { NextRequest } from "next/server"
import { ok, parseQuery } from "@/lib/api"
import { getBalances, getEarnedCredit, getLedgerPage } from "@/lib/currency"
import { withSession } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

export const GET = withSession(async (req: NextRequest, { gate }) => {
	const query = parseQuery(req, paginationQuery)
	if (query.error) return query.error

	const [balances, earned, page] = await Promise.all([
		prisma.$transaction(tx => getBalances(tx, gate.user.id)),
		prisma.$transaction(tx => getEarnedCredit(tx, gate.user.id)),
		getLedgerPage(gate.user.id, query.data.cursor, query.data.limit),
	])

	return ok({ ...balances, earned, items: page.items, nextCursor: page.nextCursor })
})
