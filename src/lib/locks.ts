import "server-only"
import type { DbOrTx } from "@/lib/prisma8"

/**
 * Take a transaction-scoped advisory lock on a named key.
 *
 * `pg_advisory_xact_lock` is released automatically when the transaction ends, including on a rollback, so this must be the first statement inside any transaction that reads state and then writes against it. The key carries its own namespace (`credit:`, `lapse:`, `ysws:`) so two unrelated locks cannot collide.
 */
export async function lockKey(tx: DbOrTx, key: string): Promise<void> {
	const plan = tx.raw.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`.affectedCount().build()
	await tx.execute(plan)
}

/**
 * Serialize every credit mutation for one user.
 *
 * The balance is `SUM(amount)` over an append-only table, so there is no row to lock and READ COMMITTED lets two concurrent transactions both read the same pre-existing balance and both commit – a double-spend, not a theoretical race: the window spans several round trips, and the goods on the other side are physical.
 */
export function lockUserCredit(tx: DbOrTx, userId: string): Promise<void> {
	return lockKey(tx, `credit:${userId}`)
}
