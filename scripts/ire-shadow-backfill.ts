import { isIreConfigured } from "../src/lib/ire-platform"
import { findAllOpenIreSubmissions, findUnsyncedIreSubmissions, sendSubmissionToIre } from "../src/lib/ire-shadow"
import db from "../src/lib/prisma8"
import { trackSideEffect } from "../src/lib/side-effects"

/**
 * Copy the currently open hand-ins into Ire.
 *
 * The deploy path sends every new submission, but the queue that existed when Ire was connected has to be replayed once. Only the newest open submission per phase is sent: older rows are history, and `meta.prior_reviews` carries what a reviewer needs from them. Re-running is safe; Ire returns the open ship as `already_queued` and the send path adopts it.
 *
 * Read-only unless `--commit`. Run with `bun --conditions=react-server scripts/ire-shadow-backfill.ts [--commit] [--limit=N] [--all] [--resend]`.
 *
 * `--all` resends every undecided hand-in in review, not just the ones missing a healthy ship. Healthy ships resolve as duplicates without new versions; decided ships are never resent.
 * In `--all` mode each healthy-looking row is verified against Ire first, so ships Ire lost (a wiped shadow database, an operator withdraw) are recreated instead of trusted blindly.
 * `--resend` withdraws and re-creates every undecided open ship, even healthy ones, so a payload change (for example `submitted_at`) reaches Ire as a new version. Use it to backfill submission dates after deploying the payload change.
 */

const commit = process.argv.includes("--commit")
const all = process.argv.includes("--all")
const resend = process.argv.includes("--resend")
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

	const scopeAll = all || resend
	const pending = (await (scopeAll ? findAllOpenIreSubmissions() : findUnsyncedIreSubmissions())).slice(
		0,
		limit ?? undefined,
	)
	console.log(
		resend
			? `${pending.length} open hand-in(s) will be withdrawn and re-created to backfill payload changes`
			: all
				? `${pending.length} open hand-in(s) will be resent to Ire`
				: `${pending.length} hand-in(s) have no healthy shadow ship in Ire`,
	)
	for (const item of pending)
		console.log(`  ${item.themeProjectId}:${item.phase}${item.reason ? ` - ${item.reason}` : ""}`)

	if (!commit) {
		console.log("Dry run. Pass --commit to send them.")
		return
	}

	let accepted = 0
	let duplicates = 0
	let failed = 0
	for (const item of pending) {
		const result = await trackSideEffect(
			"ire",
			{
				actorId: null,
				metadata: { backfill: true, phase: item.phase, resend, shadow: true },
				targetId: item.themeProjectId,
				targetType: "ThemeProject",
			},
			() =>
				sendSubmissionToIre(
					item.themeProjectId,
					item.phase,
					resend ? { resend: true } : all ? { verify: true } : undefined,
				),
		)
		if (!result) failed++
		else if ("skipped" in result) failed++
		else if (result.status === "accepted") accepted++
		else duplicates++
	}

	console.log(`accepted ${accepted}, duplicates ${duplicates}, failed ${failed}`)
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
