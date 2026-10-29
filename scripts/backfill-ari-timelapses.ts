import { or } from "@prisma/orm-postgres/orm-client"
import { isAriConfigured } from "../src/lib/ari"
import { Phase, PhaseStatus } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { type AriRefreshTarget, flag, limitArg, phaseArg, refreshAriShip } from "./ari-backfill"

/**
 * Refresh in-review hand-ins in Ari so their journals carry their timelapses.
 *
 * Ari has no update-in-place API: a ship's journals and project keys are fixed at ingestion. A hand-in already in Ari is therefore replaced by withdrawing its ship and creating it again under the same external id, which becomes the next version. This walks every phase still in review that has a timelapse, sends the ones that never reached Ari, and withdraws and re-sends the rest.
 *
 * Only in-review work is touched. A decided hand-in is not reopened: re-sending it would put already-reviewed work back in front of reviewers.
 *
 * Re-sending is also how an already-sent ship drops Hackatime project names that only a recording carried: Ari counts every named project as time, so a recording's project is evidence for its clip, not hours the maker linked. Useful after the ship builder stopped adding those names; pass `--project <themeProjectId>` to refresh one hand-in.
 *
 * It is also the repair path for ships sent before the builder netted a journal's claim against the Lapse clips Ari counts. Ari adds a journal's minutes and every clip's duration, so a maker who both devlogged and recorded a sitting was shown twice that time (a 7.9h project read as 17h). A hand-in sent since carries the net figure; an open ship from before is replaced with one by re-running this.
 *
 * Read-only unless `--commit` is passed.
 *
 * Run with `bun run ari:backfill-timelapses` (dry run), then `bun run ari:backfill-timelapses -- --limit 1 --commit` to prove it on one hand-in. Flags: `--commit`, `--phase design|build`, `--project <themeProjectId>`, `--limit <n>`.
 */

interface AriBackfillTarget extends AriRefreshTarget {
	sessions: number
	title: string
}

const commit = process.argv.includes("--commit")

/** Every in-review phase that has at least one timelapse to carry, with its open submission. */
async function loadTargets(phase: Phase | null, projectId: string | null): Promise<AriBackfillTarget[]> {
	const projects = await db.orm.public.ThemeProject.where({
		deletedAt: null,
		...(projectId ? { id: projectId } : {}),
	})
		.where(project => or(project.designStatus.eq(PhaseStatus.in_review), project.buildStatus.eq(PhaseStatus.in_review)))
		.orderBy(project => project.id.asc())
		.select("buildStatus", "designStatus", "id", "title")
		.include("submissions", submissions =>
			submissions
				.orderBy(submission => submission.createdAt.desc())
				.select("ariSubmissionId", "id", "phase", "resolvedAt"),
		)
		.include("workSessions", sessions =>
			sessions
				.where({ deletedAt: null })
				.select("phase")
				.include("timelapses", timelapses => timelapses.select("id")),
		)
		.all()

	const targets: AriBackfillTarget[] = []
	for (const project of projects)
		for (const candidate of [Phase.DESIGN, Phase.BUILD] as const) {
			if (phase && candidate !== phase) continue
			const status = candidate === Phase.DESIGN ? project.designStatus : project.buildStatus
			if (status !== PhaseStatus.in_review) continue
			const sessions = project.workSessions.filter(s => s.phase === candidate && s.timelapses.length > 0).length
			if (sessions === 0) continue
			const open = project.submissions.find(s => s.phase === candidate && s.resolvedAt === null)
			if (!open) continue
			targets.push({
				ariSubmissionId: open.ariSubmissionId,
				phase: candidate,
				sessions,
				submissionId: open.id,
				themeProjectId: project.id,
				title: project.title,
			})
		}

	return targets
}

async function main() {
	if (!isAriConfigured()) {
		console.error("Set ARI_PROGRAM_ID and ARI_SIGNING_SECRET first.")
		process.exitCode = 1
		return
	}

	const targets = await loadTargets(phaseArg(), flag("project"))
	const limit = limitArg()
	const run = limit === null ? targets : targets.slice(0, limit)

	console.log(
		`In-review hand-ins with timelapses: ${targets.length}${limit === null ? "" : ` (running ${run.length})`}`,
	)
	for (const target of run)
		console.log(
			`  ${target.phase.padEnd(6)}  ${target.title}  · ${target.sessions} entr${target.sessions === 1 ? "y" : "ies"} with timelapses  · ${target.ariSubmissionId ? "in Ari" : "never sent"}  · ${target.themeProjectId}`,
		)

	if (!commit) {
		console.log("Dry run. Pass --commit to withdraw and re-send these hand-ins.")
		return
	}

	let failed = 0
	let notQueued = 0
	let replaced = 0
	let sent = 0
	for (const target of run)
		try {
			const outcome = await refreshAriShip(target)
			if (outcome === "replaced") replaced++
			else if (outcome === "sent") sent++
			else {
				notQueued++
				console.warn(`  ${target.phase} ${target.title}: Ari has no open ship, so it was left alone`)
			}
		} catch (err) {
			failed++
			console.error(`  ${target.phase} ${target.title} (${target.themeProjectId}) failed:`, err)
		}

	console.log(`replaced: ${replaced}, sent: ${sent}, not queued: ${notQueued}, failed: ${failed}`)
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
