import { or } from "@prisma/orm-postgres/orm-client"
import { ariExternalId, parseAriExternalId } from "../src/lib/ari-id"
import { PhaseStatus } from "../src/lib/enums"
import { getHoursBreakdown } from "../src/lib/hours"
import db from "../src/lib/prisma8"
import { getReviewParity, isReviewConfigured } from "../src/lib/review-platform"

/**
 * Compare Half Life's open queue with Review's shadow queue.
 *
 * The read-only parity feed gives the external id, version, claimed hours, BOM total and check summary for every open ship. This prints the hand-ins Review is missing, the ships Review holds that Half Life no longer counts, and the per-ship numbers that disagree. It never writes and never applies a decision.
 *
 * Run with `bun --conditions=react-server scripts/review-parity.ts [--limit=50]`.
 */

function formatHours(seconds: number): string {
	return `${(seconds / 3600).toFixed(2)}h`
}

async function main() {
	if (!isReviewConfigured()) {
		console.error("Set REVIEW_API_URL, REVIEW_PROGRAM and REVIEW_SIGNING_SECRET before comparing.")
		process.exit(1)
	}

	const limitArg = process.argv.find(arg => arg.startsWith("--limit="))
	const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 50
	if (!Number.isInteger(limit) || limit <= 0) {
		console.error(`--limit must be a positive integer, got ${limitArg}`)
		process.exit(1)
	}

	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.where(project => or(project.designStatus.eq(PhaseStatus.in_review), project.buildStatus.eq(PhaseStatus.in_review)))
		.select("buildStatus", "designStatus", "id", "title")
		.all()
	const ids = projects.map(project => project.id)
	const submissions =
		ids.length > 0
			? await db.orm.public.PhaseSubmission.where({ resolvedAt: null })
					.where(submission => submission.themeProjectId.in(ids))
					.orderBy(submission => submission.createdAt.asc())
					.select("createdAt", "id", "phase", "themeProjectId")
					.all()
			: []

	const newest = new Map<string, (typeof submissions)[number]>()
	for (const submission of submissions) {
		const key = `${submission.themeProjectId}:${submission.phase}`
		const current = newest.get(key)
		if (!current || submission.createdAt > current.createdAt) newest.set(key, submission)
	}

	const parity = await getReviewParity()
	const reviewShips = new Map(parity.ships.map(ship => [ship.externalId, ship]))
	const local = [...newest.values()].slice(0, limit)

	console.log(
		`Review ${parity.ships.length} open ship(s) at ${parity.generatedAt}; Half Life ${newest.size} open hand-in(s)`,
	)
	console.log(`Comparing ${local.length} hand-in(s)\n`)

	let differences = 0
	for (const submission of local) {
		const project = projects.find(row => row.id === submission.themeProjectId)
		if (!project) continue
		const externalId = ariExternalId(submission.themeProjectId, submission.phase)
		const ship = reviewShips.get(externalId)
		if (!ship) {
			console.log(`missing in Review  ${externalId} (${project.title})`)
			differences++
			continue
		}

		const hours = await getHoursBreakdown(submission.themeProjectId, submission.phase, { live: false })
		const claimedSeconds = Math.round(hours.computedTotal * 3600)
		const bom = await db.orm.public.BomItem.where({ themeProjectId: submission.themeProjectId })
			.select("quantity", "unitCostUsd")
			.all()
		const bomTotalCents = bom.reduce((sum, item) => sum + item.quantity * Math.round(item.unitCostUsd * 100), 0)

		const mismatches: string[] = []
		if (ship.version === undefined) mismatches.push("no version")
		if (ship.hoursClaimedSeconds !== claimedSeconds)
			mismatches.push(`hours ${formatHours(ship.hoursClaimedSeconds)} vs ${formatHours(claimedSeconds)}`)
		if (ship.bomTotalCents !== bomTotalCents) mismatches.push(`BOM ${ship.bomTotalCents}c vs ${bomTotalCents}c`)

		if (mismatches.length > 0) {
			console.log(`differs            ${externalId}: ${mismatches.join("; ")}`)
			differences++
		}
	}

	for (const ship of parity.ships) {
		const parsed = parseAriExternalId(ship.externalId)
		if (!parsed) continue
		if (!newest.has(`${parsed.themeProjectId}:${parsed.phase}`)) {
			console.log(`extra in Review    ${ship.externalId} (v${ship.version}, ${ship.status})`)
			differences++
		}
	}

	console.log(`\n${differences} difference(s)`)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
