import "server-only"
import postgres, { type PostgresQueryMembers } from "@prisma/orm-postgres/runtime"
import { contractFromJson } from "@prisma/orm-postgres/static"
import type { Contract } from "@/app/generated/prisma8/contract.d"
import contractJson from "@/app/generated/prisma8/contract.json" with { type: "json" }
import { messageOf } from "@/lib/errors"
import { isRecord } from "@/lib/unknown"

declare global {
	// Cached on globalThis so Next's dev-mode module reloading doesn't open a new connection pool on every edit until Postgres refuses connections.
	// biome-ignore lint/style/useVarsOnTop: a global augmentation has to declare `var`; there is no scope above it to move.
	var halflifePrisma8: Prisma8Client | undefined
}

/**
 * The Prisma 8 client, next to the Prisma 7 one in `@/lib/prisma`, while routes move over.
 *
 * The contract is emitted by `bun run p8:contract:emit`. Only import this from server code.
 */
export const contract = contractFromJson<Contract>(contractJson)

/**
 * Only ever used while `next build` imports this module for static analysis on a machine with no database. A running server that reaches this line without DATABASE_URL throws instead of booting and 500ing every request.
 */
const BUILD_TIME_DATABASE_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder"

const createClient = () => {
	const connectionString = process.env.DATABASE_URL
	if (!connectionString && process.env.NEXT_PHASE !== "phase-production-build")
		throw new Error("DATABASE_URL is not set")
	return postgres({
		contract,
		// Matches the Prisma 7 client's pool: pg's default closes an idle connection after 10 seconds, and reopening one is a TLS handshake. The pool itself is lazy, so a build-time placeholder never connects.
		poolOptions: { idleTimeoutMillis: 300_000 },
		url: connectionString ?? BUILD_TIME_DATABASE_URL,
	})
}

export type Prisma8Client = ReturnType<typeof createClient>

/**
 * A Prisma 8 database handle: the client or a transaction.
 *
 * Both the client and `db.transaction`'s `tx` carry `orm`, `sql` and `raw`, so helpers that take this run unchanged inside and outside a transaction. Replaces `Prisma.TransactionClient` parameters (which only fit transactions, never the plain client).
 */
export type DbOrTx = PostgresQueryMembers<Contract>

/** Whether an error is a unique-constraint violation (an insert raced another insert). Prisma 8 surfaces the SQLSTATE on the error; 23505 is unique_violation on every Postgres driver. */
export function isUniqueViolation(error: unknown): boolean {
	return typeof error === "object" && error !== null && "sqlState" in error && error.sqlState === "23505"
}

/** What the drivers' transport codes mean, so a log line says why instead of repeating the code. */
const CONNECTION_CODE_MEANINGS: { [_: string]: string } = {
	EAI_AGAIN: "the database hostname did not resolve in time",
	ECONNREFUSED: "nothing is listening on that address",
	ECONNRESET: "the connection was reset before the database answered",
	EHOSTUNREACH: "the database host cannot be reached from here",
	ENETUNREACH: "no route to the database's network",
	ENOTFOUND: "the database hostname does not resolve",
	ETIMEDOUT: "the database did not answer in time",
}

/** The SQLSTATEs worth spelling out: each is a deployment fact rather than a broken query. */
const SQL_STATE_MEANINGS: { [_: string]: string } = {
	"3D000": "the database in DATABASE_URL does not exist",
	"28P01": "Postgres rejected the password in DATABASE_URL",
	"57P03": "Postgres is starting up and cannot accept connections yet",
	"28000": "Postgres refused this user",
	"53300": "Postgres has no connection slots left",
}

function stringField(value: unknown, key: string): string | undefined {
	return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined
}

/** The innermost `cause`, where the driver keeps the fact and the wrappers above it keep only the category. */
function innermostCause(error: unknown): unknown {
	let current = error
	for (let depth = 0; depth < 8; depth++) {
		const cause: unknown = isRecord(current) ? current.cause : undefined
		if (!isRecord(cause)) break
		current = cause
	}
	return current
}

/**
 * One line naming a database failure and, when the cause has a known answer, what it means.
 *
 * Prisma 8 wraps a driver failure in `SqlConnectionError`, whose own message repeats the driver's, and a stack from a production build points into a minified chunk. Neither tells an operator what the code does: `ECONNREFUSED` to the database's port is nothing listening, `28P01` is the wrong password in `DATABASE_URL`, `3D000` is a database that does not exist. This says so, so a healthcheck log answers "is the database down, or is the deployment pointed somewhere wrong?" in one line.
 */
export function describeDatabaseError(error: unknown): string {
	const root = innermostCause(error)
	const message = (root instanceof Error ? root.message : stringField(root, "message")) || messageOf(error)
	const code = stringField(root, "code") ?? stringField(error, "code")
	const sqlState = stringField(error, "sqlState") ?? stringField(root, "sqlState")
	const label = code ?? sqlState
	const meaning =
		(code === undefined ? undefined : CONNECTION_CODE_MEANINGS[code])
		?? (sqlState === undefined ? undefined : SQL_STATE_MEANINGS[sqlState])
	return [message, label && `(${label})`, meaning && `– ${meaning}`].filter(Boolean).join(" ")
}

const db = globalThis.halflifePrisma8 ?? createClient()

if (process.env.NODE_ENV !== "production") globalThis.halflifePrisma8 = db

export default db
