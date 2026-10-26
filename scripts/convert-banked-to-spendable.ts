import { CoinBucket } from "../src/lib/enums"
import db from "../src/lib/prisma8"

/**
 * Merge the legacy locked printer fund into the single spendable pot.
 *
 * New mints never write BANKED rows anymore – every coin is spendable on anything – so this moves the rows the old economy left behind. Kinds are untouched, so the review reconcile (which sums by kind, not by bucket) keeps converging exactly as before; only the bucket column moves, which is what balances and the shop read.
 *
 * One UPDATE, idempotent: running it again moves nothing. Safe to run while the app is live – no amounts change, so no totals move, only which pot they sit in.
 */
async function main() {
	const before = await db.orm.public.LedgerEntry.groupBy("bucket").aggregate(group => ({
		count: group.count(),
		total: group.sum("amount"),
	}))
	console.log("before:", JSON.stringify(before))

	const moved = await db.orm.public.LedgerEntry.where({ bucket: CoinBucket.BANKED }).updateAndCount({
		bucket: CoinBucket.SPENDABLE,
	})
	console.log(`moved ${moved} BANKED rows to SPENDABLE`)

	const after = await db.orm.public.LedgerEntry.groupBy("bucket").aggregate(group => ({
		count: group.count(),
		total: group.sum("amount"),
	}))
	console.log("after:", JSON.stringify(after))
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
