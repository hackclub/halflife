import "dotenv/config"
import { Ari, type AriShipPhase } from "@hackclub/ari"
import type { Phase } from "../src/app/generated/prisma/enums"
import { appBaseUrl, projectUrl, reviewUrl } from "../src/lib/app-url"
import { ariReviewUrl } from "../src/lib/ari-url"
import { displayName } from "../src/lib/display-name"
import prisma from "../src/lib/prisma"

/**
 * Every Starbie starter project whose hand-in is in Ari's FIRST-pass queue, one line per project, with the five links needed to work through it.
 *
 * Ari reviews in two passes: any reviewer decides first, then an organizer confirms. A first-pass decision does not reach Half Life until that second pass, so a locally unresolved `PhaseSubmission` can be in either pass – and the queue was listing both. This reads each hand-in's phase back from Ari and keeps only the first pass:
 *
 * - `review` – waiting for a reviewer to pick it up;
 * - `under_review` – claimed and being read right now.
 *
 * A hand-in in `second_pass` has already had its first-pass decision and is awaiting an organizer, so it is out. `processing` and `fraud_review` have not reached a reviewer yet, and `withdrawn`/`reverted`/`reviewed` are not awaiting one, so those are out too. The summary on stderr says how many were dropped and why, so a ship vanishing from the list is never silent.
 *
 * A project appears when any of its open hand-ins is in the first pass, so a project submitted for its design and later for its build is judged on whichever one is actually waiting. A hand-in Ari never received (`ariSubmissionId` null) is not in any pass either; the retry job owns those.
 *
 * The links are, in order:
 *
 * - the project's page as a maker sees it (`/projects/<id>`);
 * - each first-pass hand-in in the review console (`/review/<submission id>`);
 * - the maker's public profile (`/u/<user id>`);
 * - the maker's admin profile (`/admin/users/<user id>`);
 * - each hand-in's review screen on Ari (`/p/<program>/review/<ship id>`), or `-` when the deployment has no Ari program configured.
 *
 * Needs `ARI_PROGRAM_ID` and `ARI_SIGNING_SECRET` (and `ARI_BASE_URL` when it is not Ari's default), because the pass is only knowable from Ari. Output is a Markdown table on stdout, so it can be pasted into a doc or a PR; theme and phase are omitted because they said the same thing on every line. The summary goes to stderr and stays out of a redirected file. Read-only, and safe to run against production:
 *
 *   bun --conditions=react-server scripts/list-unreviewed-starbies.ts
 *   bun --conditions=react-server scripts/list-unreviewed-starbies.ts > starbies.md
 *
 * In production run it where `DATABASE_URL` and the `ARI_*` secrets point at the live program (the Orchard pod, not a dev machine).
 */

/** The starter's id in lib/config/onboarding; this is what onboarding wrote on the project when it was taken. */
const STARTER_PROJECT_ID = "starbie"

/** Ari's first pass. `second_pass` is the held decision, and every other phase is either before a reviewer or past one. */
const FIRST_PASS_PHASES: ReadonlySet<AriShipPhase> = new Set(["review", "under_review"])

/** Status reads in flight at once. Small enough to be a guest on Ari, large enough that a season's list takes seconds. */
const STATUS_CONCURRENCY = 4

/** Tabs and newlines would break the one-line-per-project shape; a title with either reads the same with a space in its place. */
function oneLine(value: string): string {
	return value.replaceAll(/[\t\r\n]+/g, " ").trim()
}

/** A Markdown table cell. A pipe in a project title would otherwise split the row into an extra column; the entity renders as one without being one. */
function mdCell(value: string): string {
	return oneLine(value).replaceAll("|", "&#124;")
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

function ariClient(): Ari {
	const programId = process.env.ARI_PROGRAM_ID
	const signingSecret = process.env.ARI_SIGNING_SECRET
	if (!programId || !signingSecret)
		throw new Error(
			"Set ARI_PROGRAM_ID and ARI_SIGNING_SECRET: the first-pass filter reads each hand-in's phase from Ari.",
		)
	return new Ari({
		programId,
		signingSecret,
		...(process.env.ARI_BASE_URL ? { baseUrl: process.env.ARI_BASE_URL } : {}),
	})
}

/** One hand-in of a project that turned out to be in Ari's first pass. */
interface FirstPassHandIn {
	ariSubmissionId: string
	createdAt: Date
	id: string
}

async function main() {
	const ari = ariClient()
	const projects = await prisma.themeProject.findMany({
		select: {
			id: true,
			submissions: {
				orderBy: { createdAt: "asc" },
				select: { ariSubmissionId: true, createdAt: true, id: true, phase: true },
				where: { resolvedAt: null },
			},
			title: true,
			user: { select: { displayName: true, id: true, name: true } },
		},
		where: {
			deletedAt: null,
			starterProjectId: STARTER_PROJECT_ID,
			submissions: { some: { resolvedAt: null } },
		},
	})

	// One status read per ship actually recorded. Keyed by ship id: two local rows can only point at one ship through a data fault, and asking twice would say nothing new.
	const ships = new Map<string, { phase: Phase; themeProjectId: string }>()
	let unsent = 0
	for (const project of projects)
		for (const submission of project.submissions) {
			if (!submission.ariSubmissionId) {
				unsent += 1
				continue
			}
			ships.set(submission.ariSubmissionId, { phase: submission.phase, themeProjectId: project.id })
		}

	const phases = new Map<string, AriShipPhase>()
	const failures: string[] = []
	await pool([...ships.keys()], STATUS_CONCURRENCY, async id => {
		try {
			const status = await ari.ships.status({ id })
			phases.set(id, status.phase)
		} catch (err) {
			const ship = ships.get(id)
			failures.push(
				`${id} (${ship ? `${ship.themeProjectId}:${ship.phase.toLowerCase()}` : "unknown"}): ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	})

	const excluded = new Map<string, number>()
	const rows: { firstPass: FirstPassHandIn[]; project: (typeof projects)[number]; waitingSince: Date }[] = []

	for (const project of projects) {
		const firstPass: FirstPassHandIn[] = []
		for (const submission of project.submissions) {
			if (!submission.ariSubmissionId) continue
			const phase = phases.get(submission.ariSubmissionId)
			if (!phase) continue
			if (!FIRST_PASS_PHASES.has(phase)) {
				excluded.set(phase, (excluded.get(phase) ?? 0) + 1)
				continue
			}
			firstPass.push({
				ariSubmissionId: submission.ariSubmissionId,
				createdAt: submission.createdAt,
				id: submission.id,
			})
		}
		const [first] = firstPass
		if (!first) continue
		rows.push({ firstPass, project, waitingSince: first.createdAt })
	}

	// Oldest hand-in first, the queue's own order: the people who have been waiting longest are the ones to look at first.
	rows.sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime())

	const base = appBaseUrl()
	console.log("| Maker | Project | Waiting since | Page | Review | Profile | Admin | Ari |")
	console.log("| --- | --- | --- | --- | --- | --- | --- | --- |")

	for (const { firstPass, project, waitingSince } of rows) {
		const reviewCell = firstPass.map(submission => `[Review](${reviewUrl(submission.id)})`).join("<br>")
		const ariLinks = firstPass
			.map(submission => ariReviewUrl(submission.ariSubmissionId))
			.filter(link => link !== null)
			.map(link => `[Ari](${link})`)
		const cells = [
			displayName(project.user, "—"),
			project.title || project.id,
			waitingSince.toISOString(),
			`[Page](${projectUrl(project.id)})`,
			reviewCell,
			`[Profile](${base}/u/${project.user.id})`,
			`[Admin](${base}/admin/users/${project.user.id})`,
			ariLinks.length > 0 ? ariLinks.join("<br>") : "—",
		]
		console.log(`| ${cells.map(value => mdCell(value)).join(" | ")} |`)
	}

	const oldest = rows[0]?.waitingSince
	console.error(
		`${rows.length} Starbie project(s) in Ari's first-pass queue${oldest ? `, oldest waiting since ${oldest.toISOString()}` : ""}`,
	)
	const dropped = [...excluded.entries()].toSorted((a, b) => b[1] - a[1]).map(([phase, count]) => `${phase} ${count}`)
	if (dropped.length > 0) console.error(`excluded hand-ins: ${dropped.join(", ")}`)
	if (unsent > 0) console.error(`excluded hand-ins never sent to Ari: ${unsent}`)
	if (failures.length > 0) {
		console.error(`status unreadable for ${failures.length} ship(s):`)
		for (const failure of failures) console.error(`  ${failure}`)
	}
}

main()
	.catch(err => {
		console.error(err instanceof Error ? err.message : err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
