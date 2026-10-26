import { z } from "zod"
import { HttpError } from "@/lib/errors"

export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 100

export const paginationQuery = z.object({
	cursor: z.string().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
})

/**
 * Where a page stops: the leading order column's value, and the id of the last row on it.
 *
 * Both halves are needed. The id alone says nothing about the timestamp it sits next to - a cuid is random - so a cursor carrying only the id cannot say which side of a tie it is on. A page boundary that falls inside a group of rows written in the same millisecond then drops one of them and repeats another.
 */
export interface CursorPosition {
	/** The leading order column's value at the cursor. Null when the column is null on that row. */
	at: Date | null
	/** The row's id, the tiebreaker the ordering falls back to. */
	id: string
}

/**
 * The order a paged list runs in.
 *
 * The leading column and the id together are a total order, so a cursor can name an exact position in it rather than a row.
 */
export interface CursorOrder {
	/** The leading order column. The page's `orderBy` starts with it. */
	column: string
	/** Which way the page runs. */
	direction: "asc" | "desc"
}

/**
 * The order a paged list runs in, and where to read the leading column's value off a row.
 *
 * The cursor is a position in this order, so the order and the cursor cannot be described apart. A cursor over a different column than the order is how rows get skipped and repeated at a page boundary.
 *
 * `TModel` is the model the list reads, so the column has to be one of its own. A column that does not exist would otherwise only be found when the query runs.
 */
export interface CursorOrderOf<T, TModel = { [_: string]: string }> extends Omit<CursorOrder, "column"> {
	/** The row's value of the leading column - the first half of the cursor. */
	at(row: T): Date | null
	/** The leading order column. */
	column: keyof TModel & string
}

/**
 * The Prisma `orderBy` for an order: the leading column, then `id` as the tiebreaker.
 *
 * The tiebreaker is what makes the order total. Without it, two rows written in the same millisecond have no order between them, and a page boundary that falls between them drops one and repeats the other.
 */
export function orderByFor<TOrder extends CursorOrder>(
	order: TOrder,
): (Record<TOrder["column"], TOrder["direction"]> | { id: TOrder["direction"] })[] {
	// The key is the column the page is ordered by, which only the type parameter names.
	const lead = { [order.column]: order.direction } as Record<TOrder["column"], TOrder["direction"]>
	return [lead, { id: order.direction }]
}

/**
 * The cursor as it travels: base64url of a JSON pair.
 *
 * Opaque on purpose. The browser only ever hands it back, and a cursor that reads as a row id is the bug this replaces - treating a position as a row.
 */
export function encodeCursor(position: CursorPosition): string {
	const payload = JSON.stringify({ at: position.at?.toISOString() ?? null, id: position.id })
	return Buffer.from(payload, "utf8").toString("base64url")
}

/**
 * Read a cursor back into the position it names.
 *
 * A cursor that has been truncated, hand-edited or copied from another list is not a position in this list's ordering, and using it as one would silently drop rows. It is a bad request, not a server error.
 */
export function decodeCursor(cursor: string): CursorPosition {
	const position = readCursor(cursor)
	if (!position) throw new HttpError("INVALID_QUERY", "That page cursor is not valid")
	return position
}

/**
 * Read a cursor back, or return null when it is not one.
 *
 * For the pages that take a cursor straight off a URL: a mistyped link should show the first page of the list, not a server error.
 */
export function readCursor(cursor: string | undefined): CursorPosition | null {
	if (!cursor) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
	} catch {
		return null
	}
	if (typeof parsed !== "object" || parsed === null) return null
	const payload = parsed as { at?: unknown; id?: unknown }
	if (typeof payload.id !== "string" || payload.id.length === 0) return null
	if (payload.at === null) return { at: null, id: payload.id }
	if (typeof payload.at !== "string") return null
	const at = new Date(payload.at)
	if (Number.isNaN(at.getTime())) return null
	return { at, id: payload.id }
}

/**
 * The Prisma filter that selects the rows after a cursor, on top of the list's own filter.
 *
 * The rows strictly after a position in a compound order are the ones with a later leading value, plus the ones with the same leading value and a later tiebreaker.
 *
 * This is a filter and not a Prisma `cursor` because a Prisma cursor names a row rather than a position: pointing it at a column that is not the leading order term does not mean "after this point", and the rows around the boundary come back reordered, repeated and missing.
 */
export function cursorWhere<TWhere extends object>(
	cursor: string | undefined,
	order: CursorOrder,
	base: TWhere,
): TWhere {
	if (!cursor) return base
	return positionWhere<TWhere>(decodeCursor(cursor), order, base)
}

/**
 * The Prisma filter that selects the rows after a position, on top of the list's own filter. No position means the start of the list.
 */
export function positionWhere<TWhere extends object>(
	position: CursorPosition | null,
	order: CursorOrder,
	base: TWhere,
): TWhere {
	if (!position) return base
	const after = order.direction === "asc" ? "gt" : "lt"
	// A row whose leading value is null. Where those sit in the order depends on the direction, because Postgres puts nulls last for an ascending order and first for a descending one. A descending page therefore reaches a null row before every dated row, so the rows after it are the rest of the nulls AND every dated row; an ascending page reaches it after them all, so only the rest of the nulls follow.
	if (position.at === null) {
		const dated = order.direction === "desc" ? { [order.column]: { not: null } } : null
		return {
			...base,
			OR: [{ [order.column]: null, id: { [after]: position.id } }, ...(dated ? [dated] : [])],
		}
	}
	return {
		...base,
		OR: [{ [order.column]: { [after]: position.at } }, { [order.column]: position.at, id: { [after]: position.id } }],
	}
}

/**
 * The rows on the page, and the cursor for the page after it.
 *
 * The cursor is the position of the last row on the page, not its id: a position says which rows come next, an id does not.
 */
export function pageResult<T extends { id: string }>(
	rows: T[],
	limit: number,
	order: CursorOrderOf<NoInfer<T>>,
): { items: T[]; nextCursor: string | null } {
	const hasMore = rows.length > limit
	const items = hasMore ? rows.slice(0, limit) : rows
	const last = items.at(-1)
	if (!hasMore || !last) return { items, nextCursor: null }
	return { items, nextCursor: encodeCursor({ at: order.at(last), id: last.id }) }
}
