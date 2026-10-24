import "server-only"
import { Kysely, PostgresDialect } from "kysely"
import { Pool, types } from "pg"

/**
 * The pool better-auth reads and writes through.
 *
 * better-auth has no Prisma 8 adapter: its Prisma adapter is built on the generated client's `prisma.user`-style API, which Prisma 8 does not have. Its maintained Kysely adapter writes the same four tables (`user`, `session`, `account`, `verification`) directly, so auth keeps its own small pool while the rest of the app uses the Prisma 8 client.
 *
 * The session timezone is pinned to UTC and `timestamp without time zone` is parsed as UTC, because the schema stores every instant that way and the app's other client reads it as UTC. Without both halves, `pg` writes the server's local offset and reads the value back as local time – identical on a UTC host, an hour off on a developer's laptop, and a session that expires an hour early.
 */

/**
 * Only ever used while `next build` imports this module for static analysis on a machine with no database. The pool itself is lazy, so a build-time placeholder never connects.
 */
const BUILD_TIME_DATABASE_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder"

/** PostgreSQL's OID for `timestamp without time zone`. */
const TIMESTAMP_OID = 1114

const parseUtcTimestamp = (value: string): Date => new Date(`${value.replace(" ", "T")}Z`)

const createPool = () => {
	const connectionString = process.env.DATABASE_URL
	if (!connectionString && process.env.NEXT_PHASE !== "phase-production-build")
		throw new Error("DATABASE_URL is not set")
	const pool = new Pool({
		connectionString: connectionString ?? BUILD_TIME_DATABASE_URL,
		idleTimeoutMillis: 300_000,
		max: 5,
		types: {
			getTypeParser: (oid, format) =>
				(String(oid) === String(TIMESTAMP_OID) ? parseUtcTimestamp : types.getTypeParser(oid, format)) as (
					value: string,
				) => unknown,
		},
	})
	// The pool hands a fresh client its first query in order, so the session timezone is set before auth's own statement runs.
	pool.on("connect", client => {
		void (async () => {
			try {
				await client.query("SET TIME ZONE 'UTC'")
			} catch (err) {
				console.error("[auth] could not pin the session timezone:", err)
			}
		})()
	})
	return pool
}

/**
 * Untyped on purpose: better-auth addresses tables and columns by name from its own schema, and typing them would mean hand-writing four table interfaces that only mirror `prisma/contract.prisma`.
 */
const createClient = () =>
	new Kysely<Record<string, Record<string, unknown>>>({ dialect: new PostgresDialect({ pool: createPool() }) })

// Cached on globalThis so Next's dev-mode module reloading does not open a new pool on every edit.
const globalForAuthDb = globalThis as unknown as { authDb?: ReturnType<typeof createClient> }

const authDb = globalForAuthDb.authDb ?? createClient()

if (process.env.NODE_ENV !== "production") globalForAuthDb.authDb = authDb

export default authDb
