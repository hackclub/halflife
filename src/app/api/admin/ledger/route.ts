import type { NextRequest } from "next/server"
import { z } from "zod"
import { ok, parseQuery } from "@/lib/api"
import { withPermission } from "@/lib/guards"
import { ledgerKindFrom, utcDay } from "@/lib/ledger-filters"
import { paginationQuery } from "@/lib/pagination"
import { hasRole, Permission, Role } from "@/lib/permissions"
import { listLedgerEntries } from "@/lib/queries/admin-ledger"
import { DAY_MS } from "@/lib/time"

export const dynamic = "force-dynamic"

const query = paginationQuery.extend({
	from: z.string().optional(),
	kind: z.string().optional(),
	q: z.string().trim().max(200).optional(),
	to: z.string().optional(),
})

/** One page of the ledger, with the same filters the page reads, as rows the client can draw. */
export const GET = withPermission(Permission.MANAGE_CREDIT, async (req: NextRequest, { gate }) => {
	const parsed = parseQuery(req, query)
	if (parsed.error) return parsed.error

	const includePii = hasRole(gate.roles, Role.ADMIN) || hasRole(gate.roles, Role.AUDITOR)
	const toDay = utcDay(parsed.data.to)
	const page = await listLedgerEntries(
		{
			from: utcDay(parsed.data.from),
			kind: ledgerKindFrom(parsed.data.kind),
			q: parsed.data.q,
			// The "to" day is inclusive, so the bound is the midnight after it.
			to: toDay ? new Date(toDay.getTime() + DAY_MS) : undefined,
		},
		{ cursor: parsed.data.cursor, limit: parsed.data.limit },
		{ includePii },
	)
	return ok({
		items: page.items.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })),
		nextCursor: page.nextCursor,
	})
})
