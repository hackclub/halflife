/**
 * A connection URL a script can hand to `Bun.SQL`.
 *
 * Prisma reads `?schema=public` from `DATABASE_URL` and pg ignores it, but Bun sends every query-string key it does not recognise as a PostgreSQL startup parameter, so the server refuses the connection with `unrecognized configuration parameter "schema"`. Dropping the key keeps one `.env` usable by both clients.
 */
export const bunSqlUrl = (value: string): string => {
	const url = new URL(value)
	url.searchParams.delete("schema")
	return url.toString()
}
