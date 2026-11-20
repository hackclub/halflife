import "../src/lib/auth"
import { and } from "@prisma/orm-postgres/orm-client"
import { inspectTimelapses } from "../src/lib/lapse"
import db from "../src/lib/prisma8"

/**
 * Fill in the Hackatime project on Lapse recordings whose row never got one.
 *
 * Ari pairs a clip to a hand-in by the project Lapse names, so a clip with no stored project is one the ship builder cannot net off the entry it belongs to. The maker is then shown the same sitting twice on Ari, which is the double count this repairs: the row's project is read from Lapse itself, which is the same answer Ari works from.
 *
 * A clip can stay unknown three ways, and they mean different things: the maker has no Lapse link or its token is gone (`unasked`, so nothing was tried), Lapse refused or never answered that id (`failed`, worth trying again), or Lapse answered and named no project (`unnamed`, in which case no later run will help and Ari cannot pair the clip either).
 *
 * Read-only unless `--commit` is passed. Run with `bun run lapse:backfill-projects`, then `-- --commit`.
 */

const commit = process.argv.includes("--commit")
const limitAt = process.argv.indexOf("--limit")
const limit = limitAt === -1 ? null : Number(process.argv[limitAt + 1])

const rows = await db.orm.public.SessionTimelapse.where(timelapse =>
	and(timelapse.provider.eq("lapse"), timelapse.hackatimeProject.isNull()),
)
	.where(timelapse => timelapse.workSession.some(session => session.deletedAt.isNull()))
	.select("externalId", "id")
	.include("workSession", session =>
		session
			.select("id")
			.include("themeProject", project => project.select("id").include("user", user => user.select("id"))),
	)
	.orderBy(timelapse => timelapse.id.asc())
	.all()

const byOwner = new Map<string, { clipId: string; externalId: string }[]>()
for (const row of rows) {
	const owner = row.workSession?.themeProject?.user?.id
	if (!owner || !row.externalId) continue
	const list = byOwner.get(owner) ?? []
	list.push({ clipId: row.id, externalId: row.externalId })
	byOwner.set(owner, list)
}

let resolved = 0
let unnamed = 0
let failed = 0
let unasked = 0
let writeFailures = 0
for (const [owner, clips] of byOwner) {
	const asked = clips.slice(0, limit ?? clips.length)
	const lookup = await inspectTimelapses(
		owner,
		asked.map(clip => clip.externalId),
	)
	if (!lookup.asked) {
		unasked += asked.length
		continue
	}
	for (const clip of asked) {
		const record = lookup.records.get(clip.externalId)
		if (!record) {
			failed += 1
			continue
		}
		if (!record.hackatimeProject) {
			unnamed += 1
			continue
		}
		resolved += 1
		if (!commit) continue
		try {
			await db.orm.public.SessionTimelapse.where({ id: clip.clipId }).update({
				hackatimeProject: record.hackatimeProject,
			})
		} catch (err) {
			writeFailures += 1
			console.error(`could not write ${clip.clipId}:`, err instanceof Error ? err.message : err)
		}
	}
}

console.log(
	`clips with no project: ${rows.length} across ${byOwner.size} makers; resolved ${resolved}, Lapse named none ${unnamed}, Lapse never answered ${failed}, no Lapse link ${unasked}, write failures ${writeFailures}.${commit ? "" : " Dry run: re-run with --commit."}`,
)

await db.close()
