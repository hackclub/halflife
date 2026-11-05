import { isIreConfigured } from "../src/lib/ire-platform"
import { findUnsyncedIreSubmissions, sendSubmissionToIre } from "../src/lib/ire-shadow"
import db from "../src/lib/prisma8"
import { trackSideEffect } from "../src/lib/side-effects"

/**
 * Copy the currently open hand-ins into Ire.
 *
 * The deploy path sends every new submission, but the queue that existed when Ire was connected has to be replayed once. Only the newest open submission per phase is sent: older rows are history, and `meta.prior_reviews` carries what a reviewer needs from them. Re-running is safe; Ire returns the open ship as `already_queued` and the send path adopts it.
 *
 * Read-only unless `--commit`. Run with `bun --conditions=react-server scripts/ire-shadow-backfill.ts [--commit] [--limit=N]`.
 */

const commit = process.argv.includes("--commit")
const limitArg = process.argv.find(arg => arg.startsWith("--limit="))
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined

async function main() {
	if (!isIreConfigured()) {
		console.error("Set IRE_API_URL, IRE_PROGRAM and IRE_SIGNING_SECRET before backfilling.")
		process.exit(1)
	}
	if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
		console.error(`--limit must be a positive integer, got ${limitArg}`)
		process.exit(1)
	}

	const pending = (await findUnsyncedIreSubmissions()).slice(0, limit ?? undefined)
	console.log(`${pending.length} hand-in(s) have no healthy shadow ship in Ire`)
	for (const item of pending)
		console.log(`  ${item.themeProjectId}:${item.phase}${item.reason ? ` - ${item.reason}` : ""}`)

	if (!commit) {
		console.log("Dry run. Pass --commit to send them.")
		return
	}

	let failed = 0
	let sent = 0
	for (const item of pending) {
		const result = await trackSideEffect(
			"ire",
			{
				actorId: null,
				metadata: { backfill: true, phase: item.phase, shadow: true },
				targetId: item.themeProjectId,
				targetType: "ThemeProject",
			},
			() => sendSubmissionToIre(item.themeProjectId, item.phase),
		)
		if (result) sent++
		else failed++
	}

	console.log(`sent ${sent}, failed ${failed}`)
	if (failed > 0) process.exitCode = 1
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
