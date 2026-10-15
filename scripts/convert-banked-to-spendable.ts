import "dotenv/config"
import prisma from "../src/lib/prisma"

/**
 * Merge the legacy locked printer fund into the single spendable pot.
 *
 * New mints never write BANKED rows anymore – every coin is spendable on anything – so this moves the rows the old economy left behind. Kinds are untouched, so the review reconcile (which sums by kind, not by bucket) keeps converging exactly as before; only the bucket column moves, which is what balances and the shop read.
 *
 * One UPDATE, idempotent: running it again moves nothing. Safe to run while the app is live – no amounts change, so no totals move, only which pot they sit in.
 */
async function main() {
	const before = await prisma.ledgerEntry.groupBy({
		_count: true,
		_sum: { amount: true },
		by: ["bucket"],
	})
	console.log("before:", JSON.stringify(before))

	const moved = await prisma.ledgerEntry.updateMany({
		data: { bucket: "SPENDABLE" },
		where: { bucket: "BANKED" },
	})
	console.log(`moved ${moved.count} BANKED rows to SPENDABLE`)

	const after = await prisma.ledgerEntry.groupBy({
		_count: true,
		_sum: { amount: true },
		by: ["bucket"],
	})
	console.log("after:", JSON.stringify(after))
}

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
