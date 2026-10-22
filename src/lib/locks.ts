import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"

/**
 * Take a transaction-scoped advisory lock on a named key.
 *
 * `pg_advisory_xact_lock` is released automatically when the transaction ends, including on a rollback, so this must be the first statement inside any `$transaction` that reads state and then writes against it. The key carries its own namespace (`credit:`, `lapse:`, `ysws:`) so two unrelated locks cannot collide.
 *
 * `$executeRaw` rather than `$queryRaw`: `pg_advisory_xact_lock` returns void, and the driver adapter cannot deserialize that as a result row.
 */
export async function lockKey(tx: Prisma.TransactionClient, key: string): Promise<void> {
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
}

/**
 * Serialize every credit mutation for one user.
 *
 * The balance is `SUM(amount)` over an append-only table, so there is no row to lock and READ COMMITTED lets two concurrent transactions both read the same pre-existing balance and both commit – a double-spend, not a theoretical race: the window spans several round trips, and the goods on the other side are physical.
 */
export function lockUserCredit(tx: Prisma.TransactionClient, userId: string): Promise<void> {
	return lockKey(tx, `credit:${userId}`)
}
