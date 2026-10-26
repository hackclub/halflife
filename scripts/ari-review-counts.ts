import { Ari } from "@hackclub/ari"
import { countAriShips } from "../src/lib/ari-counts"
import { Phase, PhaseStatus, ReviewPass, ReviewResult } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { parseDbTimestamp } from "../src/lib/time"

/**
 * Why the admin review ring and Ari's own board disagree, ship by ship.
 *
 * Ari keeps a row per ship version; Half Life keeps a `PhaseSubmission` per hand-in. The ring mirrors Ari by counting every resolved ship plus the newest open one per phase (see `lib/ari-counts`). This prints that local figure, then – with `--ari` – asks `ari.ships.status` for every ship id the local rows recorded and prints what Ari actually holds, including the states Ari's four dashboard slices leave out (`processing`, `second_pass`, `fraud_review`, `withdrawn`, `reverted`). A difference that is not one of those states is a local ship Ari does not know about (or the reverse, for a hand-in whose 409 was never adopted).
 *
 * Read-only. Run with `bun --conditions=react-server scripts/ari-review-counts.ts [--ari] [--limit=N] [--concurrency=N]` against the production database and Ari secrets. Without `--ari` it needs only the database; `--limit` bounds only the status reads, not the local counts.
 */

interface LocalShip {
	ariSubmissionId: string | null
	createdAt: Date
	id: string
	phase: Phase
	phaseStatus: PhaseStatus
	resolvedAt: Date | null
	result: ReviewResult | null
	themeProjectId: string
}

const args = process.argv.slice(2)
const checkAri = args.includes("--ari")
const limitArg = args.find(arg => arg.startsWith("--limit="))
const concurrencyArg = args.find(arg => arg.startsWith("--concurrency="))
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : null
const concurrency = concurrencyArg ? Number(concurrencyArg.slice("--concurrency=".length)) : 3

function positive(value: number | null, flag: string, fallback: number): number {
	if (value === null) return fallback
	if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer, got ${value}`)
	return value
}

/** Run `worker` over `items` at most `size` at a time. */
async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
	let next = 0
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, async () => {
			while (true) {
				const item = items[next]
				next += 1
				if (item === undefined) return
				await worker(item)
			}
		}),
	)
}

async function main(): Promise<void> {
	const programId = process.env.ARI_PROGRAM_ID
	const signingSecret = process.env.ARI_SIGNING_SECRET

	const take = positive(limit, "--limit", Number.MAX_SAFE_INTEGER)
	const submissions = await db.orm.public.PhaseSubmission.orderBy([
		submission => submission.createdAt.asc(),
		submission => submission.id.asc(),
	])
		.select(
			"ariDecision",
			"ariSubmissionId",
			"createdAt",
			"id",
			"phase",
			"resolvedAt",
			"resolvedResult",
			"themeProjectId",
		)
		.include("reviews", reviews =>
			reviews
				.where({ invalidated: false, pass: ReviewPass.FINAL })
				.orderBy([review => review.createdAt.desc(), review => review.id.desc()])
				.select("result")
				.limit(1),
		)
		.include("themeProject", project => project.select("buildStatus", "designStatus"))
		.all()

	const rows = submissions.map(submission => {
		const project = submission.themeProject
		if (!project) throw new Error(`submission ${submission.id} has no project`)
		return {
			ariSubmissionId: submission.ariSubmissionId,
			createdAt: parseDbTimestamp(submission.createdAt),
			id: submission.id,
			phase: submission.phase,
			phaseStatus: submission.phase === Phase.DESIGN ? project.designStatus : project.buildStatus,
			resolvedAt: submission.resolvedAt === null ? null : parseDbTimestamp(submission.resolvedAt),
			result:
				submission.reviews[0]?.result
				?? submission.resolvedResult
				?? (submission.ariDecision === "approved"
					? ReviewResult.APPROVED
					: submission.ariDecision === "changes"
						? ReviewResult.RETURNED
						: submission.ariDecision === "rejected"
							? ReviewResult.REJECTED
							: null),
			themeProjectId: submission.themeProjectId,
		}
	})

	const counts = countAriShips(rows)
	console.log("Local ship counts (what the admin ring shows):")
	console.log(
		`  total ${counts.approved + counts.changes + counts.rejected + counts.pending}, approved ${counts.approved}, changes ${counts.changes}, rejected ${counts.rejected}, pending ${counts.pending}`,
	)
	console.log(`  unreached (in review here, never sent to Ari): ${counts.unreached}`)

	// Rows the count leaves out, so a remaining difference can be explained without another query.
	const sent = rows.filter(row => row.ariSubmissionId !== null)
	const current = new Map<string, (typeof rows)[number]>()
	for (const row of rows) {
		const key = `${row.themeProjectId}:${row.phase}`
		const seen = current.get(key)
		if (
			!seen
			|| row.createdAt.getTime() > seen.createdAt.getTime()
			|| (row.createdAt.getTime() === seen.createdAt.getTime() && row.id > seen.id)
		)
			current.set(key, row)
	}
	const staleOpen = sent.filter(
		row => row.resolvedAt === null && current.get(`${row.themeProjectId}:${row.phase}`)?.id !== row.id,
	)
	const movedOn = [...current.values()].filter(
		row => row.resolvedAt === null && row.ariSubmissionId !== null && row.phaseStatus !== PhaseStatus.in_review,
	)
	const settledWithoutResult = sent.filter(row => row.resolvedAt !== null && row.result === null)
	console.log("Excluded by the count:")
	console.log(`  older open ships (superseded or reverted): ${staleOpen.length}`)
	console.log(`  newest open ship whose phase is not in review: ${movedOn.length}`)
	console.log(`  resolved ships with no recorded decision: ${settledWithoutResult.length}`)

	if (!checkAri) {
		console.log("Pass --ari to read each ship's phase back from Ari and compare.")
		return
	}
	if (!programId || !signingSecret)
		throw new Error("Set ARI_PROGRAM_ID and ARI_SIGNING_SECRET to read Ari's own state.")

	const ari = new Ari({
		programId,
		signingSecret,
		...(process.env.ARI_BASE_URL ? { baseUrl: process.env.ARI_BASE_URL } : {}),
	})
	const ariCounts = {
		approved: 0,
		changes: 0,
		fraudreview: 0,
		pending: 0,
		processing: 0,
		rejected: 0,
		reverted: 0,
		secondpass: 0,
		withdrawn: 0,
	}
	const byId = new Map<string, LocalShip>()
	for (const row of sent) if (row.ariSubmissionId) byId.set(row.ariSubmissionId, row)
	const targets = [...byId.keys()].slice(0, take)
	const failures: string[] = []
	const differences: string[] = []

	await pool(targets, positive(concurrency, "--concurrency", 3), async id => {
		const row = byId.get(id)
		if (!row) return
		let status: Awaited<ReturnType<typeof ari.ships.status>>
		try {
			status = await ari.ships.status({ id })
		} catch (err) {
			failures.push(`${id} (${row.themeProjectId}:${row.phase}): ${err instanceof Error ? err.message : String(err)}`)
			return
		}

		if (status.phase === "reviewed" && status.decision === "approved") ariCounts.approved += 1
		else if (status.phase === "reviewed" && status.decision === "changes") ariCounts.changes += 1
		else if (status.phase === "reviewed" && status.decision === "rejected") ariCounts.rejected += 1
		else if (status.phase === "review" || status.phase === "under_review") ariCounts.pending += 1
		else if (status.phase === "second_pass") ariCounts.secondpass += 1
		else if (status.phase === "fraud_review") ariCounts.fraudreview += 1
		else if (status.phase === "processing") ariCounts.processing += 1
		else if (status.phase === "withdrawn") ariCounts.withdrawn += 1
		else if (status.phase === "reverted") ariCounts.reverted += 1

		// The two should agree on what a ship's final decision is; a local row still open while Ari has decided is a delivery to replay.
		const decided = status.phase === "reviewed" && status.decision !== null
		if (decided && row.resolvedAt === null)
			differences.push(`${id} (${row.themeProjectId}:${row.phase}): Ari says ${status.decision}, local still open`)
		if (status.phase === "reverted" && row.resolvedAt !== null)
			differences.push(`${id} (${row.themeProjectId}:${row.phase}): Ari reverted, local counts ${row.result}`)
		if (status.phase === "reverted" && row.resolvedAt === null)
			differences.push(
				`${id} (${row.themeProjectId}:${row.phase}): Ari reverted, local still open (the reset to replay)`,
			)
		if (status.phase === "withdrawn" && row.resolvedAt === null)
			differences.push(`${id} (${row.themeProjectId}:${row.phase}): Ari withdrew this ship, local still open`)
	})

	console.log(`\nAri's own state for the first ${targets.length} recorded ship(s):`)
	console.log(
		`  approved ${ariCounts.approved}, changes ${ariCounts.changes}, rejected ${ariCounts.rejected}, pending ${ariCounts.pending}`,
	)
	console.log(
		`  not on the dashboard: processing ${ariCounts.processing}, second pass ${ariCounts.secondpass}, fraud review ${ariCounts.fraudreview}, withdrawn ${ariCounts.withdrawn}, reverted ${ariCounts.reverted}`,
	)
	if (differences.length > 0) {
		console.log(`\n${differences.length} ship(s) whose local state disagrees with Ari:`)
		for (const difference of differences) console.log(`  ${difference}`)
	}
	if (failures.length > 0) {
		console.log(`\n${failures.length} status read(s) failed:`)
		for (const failure of failures.slice(0, 20)) console.log(`  ${failure}`)
	}
}

try {
	await main()
} catch (err) {
	console.error(err instanceof Error ? err.message : err)
	process.exitCode = 1
} finally {
	await db.close()
}
