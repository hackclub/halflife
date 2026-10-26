import { and } from "@prisma/orm-postgres/orm-client"
import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { withSession } from "@/lib/guards"
import { listMyTimelapses } from "@/lib/lapse"
import db from "@/lib/prisma8"

export const dynamic = "force-dynamic"

/**
 * The caller's published Lapse timelapses, for the journal's picker.
 *
 * Each carries `attached` – whether a session already claims it – because one recording backs one session. Otherwise the same two hours of footage could be offered as proof for two entries. The session route refuses it too; this is only so the picker can say so before anyone tries. `forSession` names the entry being edited, whose own clips read as free.
 */
export const GET = withSession(async (req: NextRequest, { gate }) => {
	const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined
	const page = await listMyTimelapses(gate.user.id, cursor)

	// Editing an entry: its own clips read as unattached, so taking one off and putting it back on is picking, not a refusal. Anything else's stays claimed. The session has to be theirs, or the exclusion is ignored.
	let excludeSession: string | null = null
	const forSession = req.nextUrl.searchParams.get("forSession") ?? undefined
	if (forSession) {
		const own = await db.orm.public.WorkSession.where({ deletedAt: null, id: forSession })
			.where(session =>
				session.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.eq(gate.user.id))),
			)
			.select("id")
			.first()
		if (own) excludeSession = own.id
	}

	const used = await db.orm.public.SessionTimelapse.where({ provider: "lapse" })
		.where(timelapse => timelapse.externalId.in(page.timelapses.map(t => t.id)))
		.where(timelapse =>
			timelapse.workSession.some(session =>
				and(
					session.deletedAt.isNull(),
					session.themeProject.some(project => project.deletedAt.isNull()),
					...(excludeSession ? ([session.id.neq(excludeSession)] as const) : []),
				),
			),
		)
		.select("externalId")
		.all()
	const attached = new Set(used.map(u => u.externalId))

	return ok({
		nextCursor: page.nextCursor,
		timelapses: page.timelapses.map(t => ({
			attached: attached.has(t.id),
			createdAt: t.createdAt,
			durationSeconds: t.durationSeconds,
			hackatimeProject: t.hackatimeProject,
			id: t.id,
			processing: t.playbackUrl === null,
			thumbnailUrl: t.thumbnailUrl,
			title: t.title,
			visibility: t.visibility,
		})),
	})
})
