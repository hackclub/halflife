import { or } from "@prisma/orm-postgres/orm-client"
import "dotenv/config"
import { isAriConfigured, isWordlessJournal } from "../src/lib/ari"
import { Phase, PhaseStatus } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { type AriRefreshTarget, flag, limitArg, phaseArg, refreshAriShip } from "./ari-backfill"

/**
 * Replace in-review ships whose journals are empty work sessions with timelapses, so Ari describes what the entry is.
 *
 * A maker can attach a recording and log the time without writing a word. Those entries reached Ari titled "Work session" with no text at all, indistinguishable from an entry where the writing was forgotten. Half Life now sends a sentence naming the situation and its clip count instead, but Ari fixes a ship's journals at ingestion: only a hand-in sent after the change carries the sentence.
 *
 * This walks in-review hand-ins that hold at least one wordless entry with timelapses, and withdraws and re-creates the ship under the same external id – the same replacement `ari:backfill-timelapses` performs, scoped to the entries this text change rewrote. Only in-review work is touched: re-sending a decided hand-in would put already-reviewed work back in front of reviewers.
 *
 * Read-only unless `--commit` is passed.
 *
 * Run with `bun run ari:backfill-empty-journals` (dry run), then `bun run ari:backfill-empty-journals -- --limit 1 --commit` to prove it on one hand-in. Flags: `--commit`, `--phase design|build`, `--project <themeProjectId>`, `--limit <n>`.
 */

interface AriBackfillTarget extends AriRefreshTarget {
	sessions: number
	title: string
}

/** Every in-review phase holding a wordless entry with timelapses, with its open submission. */
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
				.select("content", "phase", "title")
				.include("timelapses", timelapses => timelapses.select("id")),
		)
		.all()

	const targets: AriBackfillTarget[] = []
	for (const project of projects)
		for (const candidate of [Phase.DESIGN, Phase.BUILD] as const) {
			if (phase && candidate !== phase) continue
			const status = candidate === Phase.DESIGN ? project.designStatus : project.buildStatus
			if (status !== PhaseStatus.in_review) continue
			const sessions = project.workSessions.filter(
				s => s.phase === candidate && s.timelapses.length > 0 && isWordlessJournal(s.content, s.title),
			)
			if (sessions.length === 0) continue
			const open = project.submissions.find(s => s.phase === candidate && s.resolvedAt === null)
			if (!open) continue
			targets.push({
				ariSubmissionId: open.ariSubmissionId,
				phase: candidate,
				sessions: sessions.length,
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

	const commit = process.argv.includes("--commit")
	const targets = await loadTargets(phaseArg(), flag("project"))
	const limit = limitArg()
	const run = limit === null ? targets : targets.slice(0, limit)

	console.log(
		`In-review hand-ins with a wordless entry and timelapses: ${targets.length}${limit === null ? "" : ` (running ${run.length})`}`,
	)
	for (const target of run)
		console.log(
			`  ${target.phase.padEnd(6)}  ${target.title}  · ${target.sessions} empty entr${target.sessions === 1 ? "y" : "ies"} with timelapses  · ${target.ariSubmissionId ? "in Ari" : "never sent"}  · ${target.themeProjectId}`,
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
