import type { NextRequest } from "next/server"
import { ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { listMyTimelapses } from "@/lib/lapse"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * The caller's published Lapse timelapses, for the journal's picker.
 *
 * Each carries `attached` — whether a session already claims it — because one
 * recording backs one session. Otherwise the same two hours of footage could
 * be offered as proof for two entries. The session route refuses it too; this
 * is only so the picker can say so before anyone tries.
 */
export const GET = withRoute(async (req: NextRequest) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined
	const page = await listMyTimelapses(gate.user.id, cursor)

	const used = await prisma.sessionTimelapse.findMany({
		where: {
			provider: "lapse",
			externalId: { in: page.timelapses.map((t) => t.id) },
			workSession: { deletedAt: null, themeProject: { deletedAt: null } },
		},
		select: { externalId: true },
	})
	const attached = new Set(used.map((u) => u.externalId))

	return ok({
		timelapses: page.timelapses.map((t) => ({
			id: t.id,
			title: t.title,
			durationSeconds: t.durationSeconds,
			visibility: t.visibility,
			createdAt: t.createdAt,
			thumbnailUrl: t.thumbnailUrl,
			hackatimeProject: t.hackatimeProject,
			processing: t.playbackUrl === null,
			attached: attached.has(t.id),
		})),
		nextCursor: page.nextCursor,
	})
})
