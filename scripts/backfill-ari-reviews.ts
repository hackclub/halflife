import "dotenv/config"
import { isAriConfigured, reconcileAriDecisions } from "../src/lib/ari"
import prisma from "../src/lib/prisma"

/**
 * Pull the decisions Ari holds onto the open hand-ins the webhook never delivered.
 *
 * The webhook is the only path a review normally takes into Half Life. It is fire-and-forget: a delivery sent while the endpoint was unregistered, misconfigured or briefly unreachable is gone, and the ship sits decided at Ari while Half Life still shows it pending. This walks the open hand-ins, asks `ari.ships.status` for each, and applies any standing decision through the same `finalizeReview` the webhook calls. It is the inbound twin of `ari-retry`, which replays hand-ins that never reached Ari.
 *
 * Nothing is written unless `--commit` is passed. A run reports how many hand-ins Ari still holds, how many it has decided, and – with `--commit` – how many were applied.
 *
 * Two limits to know before committing:
 *
 * - `ari.ships.status` carries the decision and the review's note and reviewer, so a replayed decision reaches the maker with Ari's own words rather than its generic sentence. It does not carry the approved hours, though, so a replayed approval is paid on Half Life's own hours roll-up rather than Ari's figure. Check the handful of approvals (`--commit` reports them) rather than trusting them blind.
 * - Makers are not told by default. A backlog replay can decide hundreds of hand-ins at once and the live webhook already told the maker weeks ago; announcing a bulk run would be a flood. The Airtable mirror the notice depends on is `airtable:backfill-review`'s job. Pass `--announce` only for a small, deliberate run.
 *
 * Read-only unless `--commit`. Run with
 * `bun --conditions=react-server scripts/backfill-ari-reviews.ts [--commit] [--announce] [--limit=N]`.
 * In production run it where `DATABASE_URL` and the `ARI_*` secrets both point at the live program, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")
const announce = process.argv.includes("--announce")
const limitArg = process.argv.find(arg => arg.startsWith("--limit="))
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined

async function main() {
	if (!isAriConfigured()) {
		console.error(
			"Set ARI_PROGRAM_ID and ARI_SIGNING_SECRET before backfilling – this pulls from Ari and cannot run without them.",
		)
		process.exit(1)
	}
	if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
		console.error(`--limit must be a positive integer, got ${limitArg}`)
		process.exit(1)
	}

	const summary = await reconcileAriDecisions({ announce, commit, limit })

	console.log(
		`checked ${summary.checked} open hand-in(s): ${summary.pending} still with Ari, ${summary.decided} decided, ${summary.skipped} skipped, ${summary.failed} failed to read`,
	)
	if (!commit) {
		console.log(
			`Dry run. Pass --commit to apply the ${summary.decided} standing decision(s); --announce also notifies the makers.`,
		)
		return
	}
	console.log(
		`applied ${summary.applied}, deferred ${summary.deferred} (builds waiting on their design), ${summary.skipped} skipped, ${summary.failed} failed`,
	)
	if (summary.decided > summary.applied + summary.deferred + summary.skipped + summary.failed) {
		console.log("Some decided hand-ins were not applied; run again to pick up the rest.")
	}
}

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
