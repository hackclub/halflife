/**
 * A row with some fields replaced, as a new object.
 *
 * Prisma 8 returns `timestamp(3)` columns as PostgreSQL text, so nearly every read re-shapes its rows into Dates. Spreading inline in a `.map` trips `oxc/no-map-spread`, and `Object.assign`'s intersection keeps the replaced field's old type, which loses the narrowing the rest of the function relies on. This declares the replacement's types explicitly instead.
 *
 * ```ts
 * const rows = await db.orm.public.User.select("id", "createdAt").all()
 * rows.map(row => withFields(row, { createdAt: parseDbTimestamp(row.createdAt) }))
 * ```
 */
export function withFields<T extends object, U extends object>(row: T, changes: U): Omit<T, keyof U> & U {
	return Object.assign({}, row, changes)
}
