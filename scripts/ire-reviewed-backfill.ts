import { type IreImportShip, mapReview } from "../src/lib/ire-import"
import { importReviewedShips, isIreConfigured } from "../src/lib/ire-platform"
import db from "../src/lib/prisma8"
import { buildReviewShipInput } from "../src/lib/review-ship"

/**
 * Copy ships Ari (or the console) already decided into Ire's Reviewed tab.
 *
 * Half Life has Ari's decisions in `submission_review`, including the reviewer, the approved hours and the notes, so no
 * Ari access is needed. Only the newest resolved submission per project and phase is imported: older rows are the
 * history the ship's `meta.prior_reviews` and review list already carry.
 *
 * Read-only unless `--commit`. Run with `bun --conditions=react-server scripts/ire-reviewed-backfill.ts [--commit] [--limit=N] [--ari-only]`.
 */

const commit = process.argv.includes("--commit")
const ariOnly = process.argv.includes("--ari-only")
const limitArg = process.argv.find(arg => arg.startsWith("--limit="))
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined

const importBatchSize = 50
const importBatchBytes = 12 * 1024 * 1024

async function main() {
	if (!isIreConfigured()) {
		console.error("Set IRE_API_URL, IRE_PROGRAM and IRE_SIGNING_SECRET before backfilling.")
		process.exit(1)
	}
	if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
		console.error(`--limit must be a positive integer, got ${limitArg}`)
		process.exit(1)
	}

	// Newest first, so the first row for a project and phase is the current submission.
	const rows = await db.orm.public.PhaseSubmission.orderBy(submission => submission.createdAt.desc())
		.select("ariDecision", "createdAt", "id", "phase", "resolvedAt", "themeProjectId")
		.include("themeProject", project => project.select("deletedAt", "title"))
		.include("reviews", reviews =>
			reviews
				.where({ invalidated: false })
				.orderBy(review => review.createdAt.asc())
				.select(
					"createdAt",
					"feedback",
					"frozenApprovedHours",
					"hoursOverride",
					"invalidated",
					"reason",
					"result",
					"reviewerEmail",
					"reviewerName",
				),
		)
		.all()

	const latest = new Map<string, (typeof rows)[number]>()

	for (const row of rows) {
		const key = `${row.themeProjectId}:${row.phase}`
		if (!latest.has(key)) latest.set(key, row)
	}

	// A newer submission in review means the old decision is superseded; the open shadow backfill owns that ship.
	const candidates = [...latest.values()]
		.filter(row => row.resolvedAt !== null)
		.filter(row => row.themeProject && row.themeProject.deletedAt === null)
		.filter(row => !ariOnly || row.ariDecision !== null)
		.slice(0, limit ?? undefined)
	console.log(`${candidates.length} decided hand-in(s) to import`)

	const ships: IreImportShip[] = []
	let skipped = 0
	let failed = 0

	for (const row of candidates) {
		const reviews = row.reviews
			.map(review =>
				mapReview({
					createdAt: review.createdAt,
					feedback: review.feedback,
					frozenApprovedHours: review.frozenApprovedHours,
					hoursOverride: review.hoursOverride,
					invalidated: review.invalidated,
					reason: review.reason,
					result: review.result,
					reviewerEmail: review.reviewerEmail,
					reviewerName: review.reviewerName,
				}),
			)
			.filter(review => review !== null)

		if (reviews.length === 0) {
			skipped++
			console.log(`  skip ${row.themeProjectId}:${row.phase} - no usable review`)
			continue
		}

		try {
			const { input } = await buildReviewShipInput(row.themeProjectId, row.phase, { allowResolved: true })
			const final = reviews.at(-1)
			if (!final) continue
			ships.push({ reviews, ship: input })
			console.log(
				`  ${input.external_id} - ${input.title} - ${reviews.length} review(s), ${final.decision}, ${Math.round(final.hours_approved_seconds / 3600)}h`,
			)
		} catch (err) {
			failed++
			console.error(`  fail ${row.themeProjectId}:${row.phase} - ${err instanceof Error ? err.message : String(err)}`)
		}
	}

	const batches: IreImportShip[][] = []
	let batch: IreImportShip[] = []
	let batchBytes = 0

	for (const ship of ships) {
		const size = new TextEncoder().encode(JSON.stringify(ship)).byteLength
		if (batch.length > 0 && (batch.length >= importBatchSize || batchBytes + size > importBatchBytes)) {
			batches.push(batch)
			batch = []
			batchBytes = 0
		}
		batch.push(ship)
		batchBytes += size
	}
	if (batch.length > 0) batches.push(batch)

	if (!commit) {
		console.log(`Dry run. Pass --commit to send ${ships.length} ship(s) in ${batches.length} batch(es).`)
		return
	}

	let imported = 0
	let skippedRemote = 0

	for (const [index, group] of batches.entries())
		try {
			const result = await importReviewedShips(group)
			imported += result.imported
			skippedRemote += result.skipped
			for (const failure of result.failed) {
				failed++
				console.error(`  failed ${failure.external_id} - ${failure.error}`)
			}
			console.log(
				`  batch ${index + 1}/${batches.length}: imported ${result.imported}, skipped ${result.skipped}, failed ${result.failed.length}`,
			)
		} catch (err) {
			failed += group.length
			console.error(
				`  batch ${index + 1}/${batches.length} failed - ${err instanceof Error ? err.message : String(err)}`,
			)
		}

	console.log(
		`done: imported ${imported}, skipped ${skipped + skippedRemote}, failed ${failed}${failed > 0 ? "" : "."}`,
	)
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
