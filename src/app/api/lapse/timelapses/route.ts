/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { withSession } from "@/lib/guards"
import { listMyTimelapses } from "@/lib/lapse"
import prisma from "@/lib/prisma"

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
		const own = await prisma.workSession.findFirst({
			select: { id: true },
			where: { deletedAt: null, id: forSession, themeProject: { deletedAt: null, userId: gate.user.id } },
		})
		if (own) excludeSession = own.id
	}

	const used = await prisma.sessionTimelapse.findMany({
		select: { externalId: true },
		where: {
			externalId: { in: page.timelapses.map(t => t.id) },
			provider: "lapse",
			workSession: {
				deletedAt: null,
				themeProject: { deletedAt: null },
				...(excludeSession ? { id: { not: excludeSession } } : {}),
			},
		},
	})
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
