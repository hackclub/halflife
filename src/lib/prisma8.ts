import "server-only"
import postgres, { type PostgresQueryMembers } from "@prisma/orm-postgres/runtime"
import { contractFromJson } from "@prisma/orm-postgres/static"
import type { Contract } from "@/app/generated/prisma8/contract.d"
import contractJson from "@/app/generated/prisma8/contract.json" with { type: "json" }

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
	return (
		typeof error === "object"
		&& error !== null
		&& "sqlState" in error
		&& (error as { sqlState: unknown }).sqlState === "23505"
	)
}

// Cached on globalThis so Next's dev-mode module reloading doesn't open a new connection pool on every edit until Postgres refuses connections.
const globalForPrisma8 = globalThis as unknown as { prisma8?: Prisma8Client }

const db = globalForPrisma8.prisma8 ?? createClient()

if (process.env.NODE_ENV !== "production") globalForPrisma8.prisma8 = db

export default db
