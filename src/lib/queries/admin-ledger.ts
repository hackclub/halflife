import "server-only"
import { and, or } from "@prisma/orm-postgres/orm-client"
import type { Models } from "@/app/generated/prisma8/contract.d"
import { displayName } from "@/lib/display-name"
import type { LedgerKind } from "@/lib/enums"
import { encodeCursor, readCursor } from "@/lib/pagination"
import db from "@/lib/prisma8"
import { containsPattern } from "@/lib/text"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

/** One row of the global ledger: the movement, its amount, and whose balance it moved. Timestamps are Dates, parsed from the PostgreSQL text Prisma 8 returns. */
export interface AdminLedgerRow {
	amount: number
	createdAt: Date
	id: string
	kind: Models.public_LedgerEntry["kind"]
	note: string | null
	user: { id: string; name: string | null }
}

export interface AdminLedgerFilters {
	/** Inclusive, from the start of this instant. */
	from?: Date
	kind?: LedgerKind
	/** Matches the holder's name, and their email only for a caller who may see PII. */
	q?: string
	/** Exclusive. The page passes the midnight after the chosen "to" day so a single day is included whole. */
	to?: Date
}

export interface AdminLedgerPage {
	/** How many entries the filters match, not just those on this page. */
	count: number
	items: AdminLedgerRow[]
	nextCursor: string | null
	/** The sum of the matching entries' amounts, so a page of spending can be read against its own credits. */
	total: number
}

/**
 * Every credit movement, newest first, for the staff-wide ledger.
 *
 * The filters AND together, so a search and a type and a date range narrow one another rather than replacing one another. The totals cover the whole filtered set rather than the page: a page of fifty says nothing about what a run of adjustments came to.
 */
export async function listLedgerEntries(
	filters: AdminLedgerFilters,
	opts: { cursor?: string; limit: number },
	flags?: { includePii?: boolean },
): Promise<AdminLedgerPage> {
	const includePii = flags?.includePii ?? false
	const { from, kind, to } = filters
	// Every filter ANDs, as the rest of the console's directories do: the cursor pages within the filtered list rather than cancelling a filter out.
	let entries = db.orm.public.LedgerEntry.where({})
	if (kind) entries = entries.where({ kind })
	if (from || to)
		entries = entries.where(entry =>
			and(
				...(from ? [entry.createdAt.gte(formatDbTimestamp(from))] : []),
				...(to ? [entry.createdAt.lt(formatDbTimestamp(to))] : []),
			),
		)
	const term = filters.q?.trim()
	if (term) {
		const pattern = containsPattern(term)
		// The PII rule the user directory uses: without it the search matches names only, so a holder of VIEW_USERS cannot use the ledger as a registration oracle for an address.
		entries = entries.where(entry =>
			entry.user.some(user =>
				includePii
					? or(user.name.ilike(pattern), user.displayName.ilike(pattern), user.email.ilike(pattern))
					: or(user.name.ilike(pattern), user.displayName.ilike(pattern)),
			),
		)
	}
	const totals = entries.aggregate(a => ({ count: a.count(), total: a.sum("amount") }))

	const position = readCursor(opts.cursor)
	const ordered = entries.orderBy([entry => entry.createdAt.desc(), entry => entry.id.desc()])
	// A page is rendered from a URL, so a cursor that has been hand-edited starts the list again rather than failing.
	const paged =
		position?.at === undefined || position?.at === null
			? ordered
			: ordered.cursor({ createdAt: formatDbTimestamp(position.at), id: position.id })
	const [rows, sums] = await Promise.all([
		paged
			.limit(opts.limit + 1)
			.select("amount", "createdAt", "id", "kind", "note")
			.include("user", user => user.select("displayName", "id", "name"))
			.all(),
		totals,
	])
	const items = rows.slice(0, opts.limit).map(row => {
		// The foreign key is required, so a missing holder is a data-integrity error rather than a row to render without one.
		if (!row.user) throw new Error(`ledger entry ${row.id} has no user`)
		return {
			amount: row.amount,
			createdAt: parseDbTimestamp(row.createdAt),
			id: row.id,
			kind: row.kind,
			note: row.note,
			user: { id: row.user.id, name: displayName(row.user) },
		}
	})
	const last = items.at(-1)
	return {
		count: sums.count,
		items,
		nextCursor: rows.length > opts.limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
		total: sums.total ?? 0,
	}
}
