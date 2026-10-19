import "dotenv/config"
import { Phase, PhaseStatus } from "../src/app/generated/prisma/enums"
import { isAriConfigured, sendSubmissionToAri, withdrawSubmissionFromAri } from "../src/lib/ari"
import prisma from "../src/lib/prisma"
import { trackSideEffect } from "../src/lib/side-effects"

/**
 * Refresh in-review hand-ins in Ari so their journals carry their timelapses.
 *
 * Ari has no update-in-place API: a ship's journals and project keys are fixed at ingestion. A hand-in already in Ari is therefore replaced by withdrawing its ship and creating it again under the same external id, which becomes the next version. This walks every phase still in review that has a timelapse, sends the ones that never reached Ari, and withdraws and re-sends the rest.
 *
 * Only in-review work is touched. A decided hand-in is not reopened: re-sending it would put already-reviewed work back in front of reviewers.
 *
 * Read-only unless `--commit` is passed.
 *
 * Run with `bun run ari:backfill-timelapses` (dry run), then `bun run ari:backfill-timelapses -- --limit 1 --commit` to prove it on one hand-in. Flags: `--commit`, `--phase design|build`, `--project <themeProjectId>`, `--limit <n>`.
 */

interface AriBackfillTarget {
	ariSubmissionId: string | null
	phase: Phase
	sessions: number
	submissionId: string
	themeProjectId: string
	title: string
}

const commit = process.argv.includes("--commit")

function flag(name: string): string | null {
	const args = process.argv.slice(2)
	for (const [index, arg] of args.entries()) {
		if (arg === `--${name}`) return args[index + 1] ?? null
		if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3)
	}
	return null
}

function phaseArg(): Phase | null {
	const raw = flag("phase")
	if (raw === null) return null
	const phase = raw.toUpperCase()
	if (phase === Phase.DESIGN || phase === Phase.BUILD) return phase
	throw new Error(`--phase must be design or build, got ${raw}`)
}

function limitArg(): number | null {
	const raw = flag("limit")
	if (raw === null) return null
	const value = Number(raw)
	if (!Number.isInteger(value) || value <= 0) throw new Error(`--limit must be a positive integer, got ${raw}`)
	return value
}

/** Every in-review phase that has at least one timelapse to carry, with its open submission. */
async function loadTargets(phase: Phase | null, projectId: string | null): Promise<AriBackfillTarget[]> {
	const projects = await prisma.themeProject.findMany({
		orderBy: { id: "asc" },
		select: {
			buildStatus: true,
			designStatus: true,
			id: true,
			submissions: {
				orderBy: { createdAt: "desc" },
				select: { ariSubmissionId: true, id: true, phase: true, resolvedAt: true },
			},
			title: true,
			workSessions: { select: { phase: true }, where: { deletedAt: null, timelapses: { some: {} } } },
		},
		where: {
			deletedAt: null,
			...(projectId ? { id: projectId } : {}),
			OR: [{ designStatus: PhaseStatus.in_review }, { buildStatus: PhaseStatus.in_review }],
		},
	})

	const targets: AriBackfillTarget[] = []
	for (const project of projects)
		for (const candidate of [Phase.DESIGN, Phase.BUILD] as const) {
			if (phase && candidate !== phase) continue
			const status = candidate === Phase.DESIGN ? project.designStatus : project.buildStatus
			if (status !== PhaseStatus.in_review) continue
			const sessions = project.workSessions.filter(s => s.phase === candidate).length
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

/** The state a hand-in was left in, so the summary can tell a fresh send from a replaced ship. */
type RefreshOutcome = "not-queued" | "replaced" | "sent"

/**
 * Send one hand-in with its current evidence.
 *
 * A ship that is already in Ari has to be withdrawn first: creating another ship for the same external id while one is open is a conflict, not an update. `not_queued` means Ari holds no open ship under that id – usually because it has already decided it – and re-sending would put a decided hand-in back in the queue, so it is reported and left alone.
 */
async function refresh(target: AriBackfillTarget): Promise<RefreshOutcome> {
	let replaced = false
	if (target.ariSubmissionId) {
		const withdrawn = await trackSideEffect(
			"ari",
			{
				actorId: null,
				metadata: { backfill: true, phase: target.phase, withdrawn: true },
				targetId: target.themeProjectId,
				targetType: "ThemeProject",
			},
			() => withdrawSubmissionFromAri(target.themeProjectId, target.phase),
			{ rethrow: true },
		)
		if (withdrawn && "status" in withdrawn) {
			if (withdrawn.status === "not_queued") return "not-queued"
			replaced = true
		}
		// The old ship is gone, so its id must go too: if the send below fails, `ari-retry` has to see this hand-in as unsent rather than skip it because a stale id says it already reached Ari.
		await prisma.phaseSubmission.updateMany({
			data: { ariSubmissionId: null },
			where: { id: target.submissionId, resolvedAt: null },
		})
	}

	const sent = await trackSideEffect(
		"ari",
		{
			actorId: null,
			metadata: { backfill: true, phase: target.phase, refreshed: target.ariSubmissionId !== null },
			targetId: target.themeProjectId,
			targetType: "ThemeProject",
		},
		() => sendSubmissionToAri(target.themeProjectId, target.phase),
		{ rethrow: true },
	)
	if (!sent || "skipped" in sent) throw new Error("Ari is not configured, or the hand-in is no longer awaiting review")
	return replaced ? "replaced" : "sent"
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
			const outcome = await refresh(target)
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

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
