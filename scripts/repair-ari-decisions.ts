import "dotenv/config"
import { isAriConfigured, repairStatusDecisions } from "../src/lib/ari"
import prisma from "../src/lib/prisma"

/**
 * Give decisions the status pass rebuilt the reviewer's words they should have had.
 *
 * A decision the webhook never delivered is applied from `ari.ships.status` by `reconcileAriDecisions` (`ari-retry`) or by `reviews:backfill-ari`. An older status response carried only the decision, so those decisions were recorded with `defaultFeedback` in place of the note and the maker read "Ari asked for changes before this can be approved." where the reviewer's own words belonged. The status response carries the review now, and this walks the placeholder decisions already in the database and replaces the fallback with what the reviewer actually wrote – the review row, the audit reason, the reviewer's address, and the project's standing comment.
 *
 * Only a decision the status pass rebuilt is touched, matched by the exact placeholder it left behind (see `repairStatusDecisions`). A decision a person or a delivered webhook made is never rewritten, and a placeholder whose ship has since moved on, changed its decision or been superseded by a newer ship is left alone. `reconcileAriDecisions` keeps decisions applied from now on correct on its own, so this is a one-off for the ones already applied.
 *
 * Read-only unless `--commit` is passed, so a run reports what it would repair. Run with
 * `bun --conditions=react-server scripts/repair-ari-decisions.ts [--commit] [--limit=N]`.
 * In production run it where `DATABASE_URL` and the `ARI_*` secrets both point at the live program, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")
const limitArg = process.argv.find(arg => arg.startsWith("--limit="))
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined

async function main() {
	if (!isAriConfigured()) {
		console.error(
			"Set ARI_PROGRAM_ID and ARI_SIGNING_SECRET before repairing – this reads each decision back from Ari and cannot run without them.",
		)
		process.exit(1)
	}
	if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
		console.error(`--limit must be a positive integer, got ${limitArg}`)
		process.exit(1)
	}

	const summary = await repairStatusDecisions({ commit, limit })
	console.log(
		`checked ${summary.checked} placeholder decision(s): ${summary.standing} still final at Ari, ${summary.quiet} with no note to show, ${summary.skipped} skipped, ${summary.failed} failed to read`,
	)
	if (!commit) {
		console.log(
			`Dry run. Pass --commit to rewrite the ${summary.standing - summary.quiet} placeholder(s) that have a note.`,
		)
		return
	}
	console.log(`repaired ${summary.repaired} decision(s)`)
}

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
