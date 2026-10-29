import "server-only"
import { Kysely, PostgresDialect } from "kysely"
import { Pool, types } from "pg"
import { describeDatabaseError } from "@/lib/db-error"

declare global {
	// Cached on globalThis so Next's dev-mode module reloading does not open a new pool on every edit.
	// biome-ignore lint/style/useVarsOnTop: a global augmentation has to declare `var`; there is no scope above it to move.
	var halflifeAuthDb: ReturnType<typeof createClient> | undefined
}

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

const parseUtcTimestamp = (value: string): Date => new Date(`${value.replace(" ", "T")}Z`)

// pg reads `timestamp without time zone` as local time by default; the schema stores every instant as UTC, so the parser is replaced for this process. `builtins.TIMESTAMP` is PostgreSQL's OID for that type (1114).
types.setTypeParser(types.builtins.TIMESTAMP, parseUtcTimestamp)

const createPool = () => {
	const connectionString = process.env.DATABASE_URL
	if (!connectionString && process.env.NEXT_PHASE !== "phase-production-build")
		throw new Error("DATABASE_URL is not set")
	const pool = new Pool({
		connectionString: connectionString ?? BUILD_TIME_DATABASE_URL,
		idleTimeoutMillis: 300_000,
		max: 5,
	})
	// An error on an idle client is re-emitted on the pool once pg-pool has dropped that client, and an EventEmitter with no 'error' listener throws – so a database restart used to arrive as `uncaughtException` with the socket, the client and every pg internal in the log. The client listener below has already reported it; this one only stops the re-emit from being fatal.
	pool.on("error", () => undefined)
	pool.on("connect", client => {
		// pg-pool takes its own error listener off a client while it is checked out, so a FATAL from the server – a restart, a failover, an operator terminating the backend – arriving between two statements would be an unhandled 'error' event and end the process. One line, naming the reason; the dead client is removed from the pool when it is released, because pg marks it unqueryable.
		client.on("error", err => console.error(`[auth] database connection lost: ${describeDatabaseError(err)}`))
		// The pool hands a fresh client its first query in order, so the session timezone is set before auth's own statement runs.
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
	new Kysely<{ [_: string]: { [_: string]: unknown } }>({ dialect: new PostgresDialect({ pool: createPool() }) })

const authDb = globalThis.halflifeAuthDb ?? createClient()

if (process.env.NODE_ENV !== "production") globalThis.halflifeAuthDb = authDb

export default authDb
