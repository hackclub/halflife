import "../src/lib/auth"
import { and } from "@prisma/orm-postgres/orm-client"
import { lookupTimelapses } from "../src/lib/lapse"
import db from "../src/lib/prisma8"

/**
 * Fill in the Hackatime project on Lapse recordings whose row never got one.
 *
 * Ari pairs a clip to a hand-in by the project Lapse names, so a clip with no stored project is one the ship builder cannot net off the entry it belongs to. The maker is then shown the same sitting twice on Ari, which is the double count this repairs: the row's project is read from Lapse itself, which is the same answer Ari works from.
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
let unresolved = 0
let failed = 0
for (const [owner, clips] of byOwner) {
	const asked = clips.slice(0, limit ?? clips.length)
	const found = await lookupTimelapses(
		owner,
		asked.map(clip => clip.externalId),
	)
	for (const clip of asked) {
		const project = found.get(clip.externalId)?.hackatimeProject ?? null
		if (!project) {
			unresolved += 1
			continue
		}
		resolved += 1
		if (!commit) continue
		try {
			await db.orm.public.SessionTimelapse.where({ id: clip.clipId }).update({ hackatimeProject: project })
		} catch (error) {
			failed += 1
			console.error(`could not write ${clip.clipId}:`, error instanceof Error ? error.message : error)
		}
	}
}

console.log(
	`clips with no project: ${rows.length} across ${byOwner.size} makers; resolved ${resolved}, still unknown ${unresolved}, write failures ${failed}.${commit ? "" : " Dry run: re-run with --commit."}`,
)
