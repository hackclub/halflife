import "dotenv/config"
import type { Phase } from "../src/lib/enums"
import { refreshOverlapSpans } from "../src/lib/hours"
import { lapseCredentials, verifyOwnTimelapses } from "../src/lib/lapse"
import prisma from "../src/lib/prisma"

/**
 * Fill in the two facts a timelapse row cannot be deduplicated without: WHEN the recording was made, and which Hackatime project Lapse saw while it ran.
 *
 * Someone who codes with Hackatime running and records a Lapse timelapse of the same sitting had that sitting counted twice – once by their journal entry and once by the linked Hackatime project. Fixing that needs the two tools' clocks to be compared, and a timelapse row only ever stored a duration. `recordedAt` and `hackatimeProject` carry the rest.
 *
 * Rows are asked of Lapse through each owner's own OAuth token, one request per recording rather than per person, because a recording's facts are its own and a token that has expired fails for one account rather than the whole run.
 *
 * Lapse tokens last 30 days and this repo cannot refresh them, so a token that has lapsed means that person's recordings stay undeduplicated. That is the honest outcome – a window guessed from the row's created_at (when the clip was ATTACHED, possibly days later) would subtract Hackatime time from the wrong sitting and underpay them. Those rows are listed at the end so they can be re-run after the owner signs in with Lapse again.
 *
 * Safe to run again: it starts from the rows still missing a recording start.
 *
 * Run with `pnpm hours:backfill-overlap`.
 */
const PACE_MS = 250

async function main() {
	// One recording per row, grouped by owner so a lapsed token is discovered once instead of once per clip.
	const rows = await prisma.sessionTimelapse.findMany({
		orderBy: { id: "asc" },
		select: {
			externalId: true,
			id: true,
			workSession: { select: { phase: true, themeProject: { select: { userId: true } }, themeProjectId: true } },
		},
		where: { externalId: { not: null }, provider: "lapse", recordedAt: null, workSession: { deletedAt: null } },
	})
	if (rows.length === 0) {
		console.log("every Lapse timelapse already records when it was made")
		return
	}

	const byUser = new Map<string, typeof rows>()
	for (const row of rows) {
		const list = byUser.get(row.workSession.themeProject.userId) ?? []
		list.push(row)
		byUser.set(row.workSession.themeProject.userId, list)
	}

	const started = Date.now()
	let filled = 0
	let unfillable = 0
	const stranded: string[] = []

	for (const [userId, theirs] of byUser) {
		try {
			await lapseCredentials(userId)
		} catch {
			// No Lapse token, or one that has lapsed. Reported, never guessed at.
			unfillable += theirs.length
			stranded.push(`${userId} (${theirs.length} recording${theirs.length === 1 ? "" : "s"})`)
			continue
		}

		for (const row of theirs) {
			const lapseId = row.externalId ?? ""
			if (!lapseId) continue
			try {
				// The same ownership and processing checks the attach path makes, so a backfill can never attach facts to a recording the platform would refuse today.
				const [timelapse] = await verifyOwnTimelapses(userId, [lapseId])
				if (!timelapse) continue
				await prisma.sessionTimelapse.update({
					data: { hackatimeProject: timelapse.hackatimeProject, recordedAt: new Date(timelapse.createdAt) },
					where: { id: row.id },
				})
				filled += 1
			} catch {
				// Gone private, deleted, or still processing. Same as unattached.
				unfillable += 1
			}
			await new Promise(resolve => setTimeout(resolve, PACE_MS))
		}
	}

	// Warm the cached spans for every phase that just gained a window, so the review screen shows the deduplicated total rather than discovering the overlap at approval time.
	const phases = new Map<string, { themeProjectId: string; phase: Phase }>()
	for (const row of rows)
		phases.set(`${row.workSession.themeProjectId}:${row.workSession.phase}`, {
			phase: row.workSession.phase,
			themeProjectId: row.workSession.themeProjectId,
		})

	for (const target of phases.values()) await refreshOverlapSpans(target.themeProjectId, target.phase)

	console.log(
		`timelapse overlap: ${filled} of ${rows.length} recordings given a start time, ${unfillable} left undeduplicated, ${((Date.now() - started) / 1000).toFixed(1)}s`,
	)
	if (stranded.length > 0) {
		console.warn(`${stranded.length} participant(s) need to sign in with Lapse before their recordings can be filled:`)
		for (const line of stranded) console.warn(`  ${line}`)
	}
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exit(1)
} finally {
	await prisma.$disconnect()
}
