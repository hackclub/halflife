import "dotenv/config"
import prisma from "../src/lib/prisma"
import { recomputeAllStreaks } from "../src/lib/streak"

/**
 * Rebuild every user's streak from the devlogs and reels already stored.
 *
 * A streak is derived rather than incremented, so this is always safe to run: it reads the rows and overwrites the `currentStreak` / `longestStreak` / `lastStreakDate` cache. Needed once for participants whose devlogs arrived through the Stasis import, which wrote `WorkSession` rows directly and never touched the streak columns – which is why every imported account read 0.
 *
 * Run with `pnpm streaks:recompute`.
 */
async function main() {
	const started = Date.now()
	const users = await recomputeAllStreaks()
	console.log(`recomputed streaks for ${users} users in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exit(1)
} finally {
	await prisma.$disconnect()
}
