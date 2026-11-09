import type { NextRequest } from "next/server"
import { z } from "zod"
import { fail, ok, parseQuery } from "@/lib/api"
import { withSession } from "@/lib/guards"
import { listUserProjects, phaseWeekWindow } from "@/lib/hackatime"
import db from "@/lib/prisma8"
import { phaseSchema } from "@/lib/schemas/common"

export const dynamic = "force-dynamic"

const projectsQuery = z
	.object({
		phase: phaseSchema,
		projectId: z.string().min(1).max(64),
	})
	.strict()

/**
 * The picker's options, priced in the same window the link will store.
 *
 * The project is read to find its theme, so a caller cannot ask for a week that is not this project's own; the ownership check keeps one participant from pricing another's project.
 */
export const GET = withSession(async (req: NextRequest, { gate }) => {
	const query = parseQuery(req, projectsQuery)
	if (query.error) return query.error

	const user = await db.orm.public.User.whereUnique({ id: gate.user.id }).select("hackatimeUserId").first()
	if (!user?.hackatimeUserId) return fail("HACKATIME_NOT_LINKED", "Link your Hackatime account first")

	const project = await db.orm.public.ThemeProject.where({
		deletedAt: null,
		id: query.data.projectId,
		userId: gate.user.id,
	})
		.select("theme")
		.first()
	if (!project) return fail("NOT_FOUND", "Project not found")

	const window = await phaseWeekWindow(project.theme, query.data.phase, gate.user.id, query.data.projectId)
	return ok({ projects: await listUserProjects(user.hackatimeUserId, window ?? undefined) })
})
