import { z } from "zod"
import { Phase } from "@/app/generated/prisma/enums"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { getThemeDef } from "@/lib/config/program"
import { requireSession } from "@/lib/guards"
import { getHoursBreakdown } from "@/lib/hours"
import prisma from "@/lib/prisma"
import { assertWeekStarted } from "@/lib/program"
import { ensureThemeProject, themeForDesignWeek } from "@/lib/provisioning"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const projects = await prisma.themeProject.findMany({
		where: { userId: gate.user.id, deletedAt: null },
	})

	const items = await Promise.all(
		projects.map(async (project) => {
			const [design, build] = await Promise.all([
				getHoursBreakdown(project.id, Phase.DESIGN),
				getHoursBreakdown(project.id, Phase.BUILD),
			])
			const def = getThemeDef(project.theme)
			return {
				id: project.id,
				theme: project.theme,
				slug: def.slug,
				label: def.label,
				title: project.title,
				designStatus: project.designStatus,
				buildStatus: project.buildStatus,
				designWeek: def.designWeek,
				buildWeek: def.buildWeek,
				tier: project.tier,
				grantUsd: project.grantUsd,
				hours: { design: design.effectiveHours, build: build.effectiveHours },
			}
		}),
	)

	// Program order, not insertion order.
	items.sort((a, b) => a.designWeek - b.designWeek)
	return ok({ projects: items })
})

const createSchema = z.object({ weekId: z.number().int().min(1).max(10) }).strict()

/**
 * Create the project for a design week – called when its "create a project" checkpoint is opened, which is the only moment a project row is made (see lib/provisioning). Opening it again returns the same row.
 */
export const POST = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const parsed = await parseBody(req, createSchema)
	if (parsed.error) return parsed.error

	const theme = themeForDesignWeek(parsed.data.weekId)
	if (!theme) return fail("VALIDATION_FAILED", "That week does not start a project")
	await assertWeekStarted(parsed.data.weekId)

	const project = await ensureThemeProject(gate.user.id, theme)
	return ok({ id: project.id }, { status: 201 })
})
