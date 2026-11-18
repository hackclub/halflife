import "../src/lib/auth"
import { or } from "@prisma/orm-postgres/orm-client"
import { Phase, PhaseStatus } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { buildReviewShipInput } from "../src/lib/review-ship"

/**
 * Check every open hand-in's Ari arithmetic against Half Life's own.
 *
 * The two platforms count hours differently and only Half Life can see both sides: Ari adds the journals it was given, every Lapse clip under a named Hackatime project, and Hackatime; Half Life settles on its own journal and Hackatime total. The ship builder takes the difference off the journals, so the number a reviewer sets a decision against is the number Half Life will freeze. This reads ships back to prove that held, and names the ones where it did not.
 *
 * A drift means Ari will show a reviewer something else: positive is work credited that Half Life does not count, negative is a maker being shown less than their own log says. Both are worth a look; anything under a minute is the rounding of whole journal minutes.
 *
 * Read-only. Run with `bun run verify:ari-hours`, or scope it with `-- --project <themeProjectId>` or `-- --limit <n>` when a full pass is more than you need. The tolerance is two minutes: Ari reads Hackatime live where this reads the cache, so a minute of disagreement between the two is the fetch, not the ship.
 */

const TOLERANCE_SECONDS = 120
const projectAt = process.argv.indexOf("--project")
const projectFilter = projectAt === -1 ? null : (process.argv[projectAt + 1] ?? null)
const limitAt = process.argv.indexOf("--limit")
const limit = limitAt === -1 ? null : Number(process.argv[limitAt + 1])

const projects = await db.orm.public.ThemeProject.where({
	deletedAt: null,
	...(projectFilter ? { id: projectFilter } : {}),
})
	.where(project => or(project.designStatus.eq(PhaseStatus.in_review), project.buildStatus.eq(PhaseStatus.in_review)))
	.select("buildStatus", "designStatus", "id", "title")
	.orderBy(project => project.id.asc())
	.all()

let checked = 0
let drifted = 0
let unabsorbed = 0
let unattributed = 0
const failures: string[] = []

for (const project of projects) {
	if (limit !== null && checked >= limit) break
	for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
		const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
		if (status !== PhaseStatus.in_review) continue
		let ship: Awaited<ReturnType<typeof buildReviewShipInput>>
		try {
			ship = await buildReviewShipInput(project.id, phase)
		} catch (error) {
			// A project that cannot be sent at all is already reported where it was submitted; naming it here as a drift would bury the real failures.
			failures.push(
				`${project.title} (${phase}): not sendable – ${error instanceof Error ? error.message : String(error)}`,
			)
			continue
		}
		const { hours } = ship.input.meta
		checked += 1
		const halfLife = hours.claimed_seconds
		const ari = hours.ari_expected_seconds ?? halfLife
		const drift = ari - halfLife
		if (Math.abs(drift) > TOLERANCE_SECONDS)
			console.log(
				`DRIFT ${project.title} (${phase}): halflife ${fmt(halfLife)}, ari ${fmt(ari)} (${drift > 0 ? "+" : ""}${fmt(drift)}), foreign ${fmt(hours.timelapse_foreign_seconds ?? 0)}, carried ${fmt(hours.timelapse_carried_seconds ?? 0)}, unattributed ${fmt(hours.timelapse_unattributed_seconds ?? 0)}`,
			)
		if (Math.abs(drift) > TOLERANCE_SECONDS) drifted += 1
		if ((hours.timelapse_unabsorbed_seconds ?? 0) > 0) unabsorbed += 1
		if ((hours.timelapse_unattributed_seconds ?? 0) > 0) unattributed += 1
	}
}

function fmt(seconds: number): string {
	const sign = seconds < 0 ? "-" : ""
	const abs = Math.abs(Math.round(seconds))
	return `${sign}${Math.floor(abs / 3600)}h${String(Math.floor((abs % 3600) / 60)).padStart(2, "0")}m`
}

console.log(
	`open hand-ins: ${checked} checked, ${drifted} drifting more than ${TOLERANCE_SECONDS}s, ${unabsorbed} with footage the journals could not absorb, ${unattributed} with clips nothing could attribute, ${failures.length} not sendable.`,
)
for (const failure of failures) console.log(`  ${failure}`)
if (drifted > 0) process.exit(1)
