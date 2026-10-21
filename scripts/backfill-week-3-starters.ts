import "dotenv/config"
import { PhaseStatus, Theme } from "../src/app/generated/prisma/enums"
import { getStarterProject } from "../src/lib/config/onboarding"
import prisma from "../src/lib/prisma"

/**
 * Move the Music projects that were handed Starbie as week 3's starter onto the MIDI keyboard.
 *
 * Until 2026-10-19, Starbie was listed for every theme that had no starter of its own, Music included. Week 3 opened at 04:00 UTC that day, and Starbie was taken off Music at 13:35 UTC, so a project created in that window kept `starterProjectId: "starbie"` on a Music project. The project page and the trail read that stored id, not the week's current list, so those participants still see the week-one guide on a week-three project.
 *
 * The current config cannot produce this pairing – `starterProjectsFor(Theme.SYNTH)` returns only the MIDI keyboard – so every row this finds is a leftover from that window or an imported copy of one.
 *
 * A project that already has work in it is reported and left alone: its maker may have started building Starbie under the old copy, and swapping the guide out from under them would be worse than leaving the one they began with. Only untouched rows are switched, and their title and description move too only while they are still the starter's stock words.
 *
 * Read-only unless `--commit` is passed. Run with
 * `bun --conditions=react-server scripts/backfill-week-3-starters.ts [--commit]`.
 * In production run it where `DATABASE_URL` points at the live database.
 */

const commit = process.argv.includes("--commit")

async function main() {
	const starbie = getStarterProject("starbie")
	const midi = getStarterProject("midi")
	if (!starbie || !midi) {
		console.error("Starbie and the MIDI keyboard both have to be in STARTER_PROJECTS for this repair to mean anything.")
		process.exit(1)
	}

	const projects = await prisma.themeProject.findMany({
		orderBy: { createdAt: "asc" },
		select: {
			_count: { select: { submissions: true, workSessions: true } },
			buildStatus: true,
			createdAt: true,
			description: true,
			designStatus: true,
			id: true,
			title: true,
		},
		where: { deletedAt: null, starterProjectId: starbie.id, theme: Theme.SYNTH },
	})

	console.log(`Music projects still on Starbie: ${projects.length}`)

	const untouched = projects.filter(
		p =>
			p._count.submissions === 0
			&& p._count.workSessions === 0
			&& p.designStatus === PhaseStatus.draft
			&& p.buildStatus === PhaseStatus.draft,
	)
	const started = projects.length - untouched.length

	for (const p of projects) {
		const work =
			p._count.submissions === 0 && p._count.workSessions === 0
				? "no work"
				: `${p._count.workSessions} session(s), ${p._count.submissions} hand-in(s)`
		const stock = p.title === starbie.title && p.description === starbie.description
		console.log(`  ${p.createdAt.toISOString()}  ${p.title || "(untitled)"}  ${work}${stock ? "" : " (custom words)"}`)
	}
	if (started > 0) console.log(`${started} project(s) have work and are left alone.`)

	if (!commit) {
		console.log("Dry run. Pass --commit to switch the untouched projects to the MIDI keyboard.")
		return
	}

	let updated = 0
	for (const p of untouched) {
		await prisma.themeProject.update({
			data: {
				// Only replace the words the starter filled in. A maker who renamed the project or wrote their own description keeps both.
				...(p.title === starbie.title ? { title: midi.title } : {}),
				...(p.description === starbie.description ? { description: midi.description } : {}),
				starterProjectId: midi.id,
			},
			where: { id: p.id },
		})
		updated++
	}
	console.log(`updated: ${updated}, left alone: ${started}`)
}

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
