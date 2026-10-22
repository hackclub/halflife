import { z } from "zod"
import { HoursSource, Phase } from "@/app/generated/prisma/enums"
import { fail, ok, parseBody } from "@/lib/api"
import { getThemeDef, themeForDesignWeek } from "@/lib/config/program"
import { withSession } from "@/lib/guards"
import { rollUpHours } from "@/lib/hours"
import { type RecordedWindow, timelapseWindow } from "@/lib/hours-overlap"
import prisma from "@/lib/prisma"
import { assertWeekStarted } from "@/lib/program"
import { ensureThemeProject } from "@/lib/provisioning"

export const dynamic = "force-dynamic"

export const GET = withSession(async (_req: Request, { gate }) => {
	// The rows behind every project's hours, loaded once for the whole list.
	//
	// This used to ask `getHoursBreakdown` for each project and phase, which is three queries each – six per project, on a page that shows every project the maker has. `rollUpHours` is the summation half of that breakdown, separated so a caller holding the rows in bulk can apply the same rules without the extra round trips.
	const [projects, sessions, links] = await Promise.all([
		prisma.themeProject.findMany({
			select: {
				approvedHours: true,
				buildStatus: true,
				designApprovedHours: true,
				designStatus: true,
				grantUsd: true,
				id: true,
				theme: true,
				tier: true,
				title: true,
			},
			where: { deletedAt: null, userId: gate.user.id },
		}),
		prisma.workSession.findMany({
			select: {
				hoursApproved: true,
				hoursClaimed: true,
				hoursSource: true,
				phase: true,
				themeProjectId: true,
				timelapses: { select: { coveredSeconds: true, hackatimeProject: true, recordedAt: true } },
			},
			where: { deletedAt: null, themeProject: { deletedAt: null, userId: gate.user.id } },
		}),
		prisma.hackatimeLink.findMany({
			select: {
				cachedSeconds: true,
				cachedSpans: true,
				hackatimeProject: true,
				hoursApproved: true,
				phase: true,
				themeProjectId: true,
			},
			where: { themeProject: { deletedAt: null, userId: gate.user.id } },
		}),
	])

	// Every recording this maker has, whatever project or phase it was attached to. A link finds the ones made under its own project by the name the recording carried, which is how a clip journalled in one week is deduplicated against a link in another.
	const recordings: RecordedWindow[] = sessions.flatMap(s =>
		s.hoursSource === HoursSource.HACKATIME_TRACKED
			? []
			: s.timelapses.flatMap(t => {
					const window = timelapseWindow(t.recordedAt, t.coveredSeconds)
					return window ? [{ hackatimeProject: t.hackatimeProject, window }] : []
				}),
	)

	const items = projects.map(project => {
		const def = getThemeDef(project.theme)
		const design = rollUpHours(
			sessions.filter(s => s.themeProjectId === project.id && s.phase === Phase.DESIGN),
			links.filter(l => l.themeProjectId === project.id && l.phase === Phase.DESIGN),
			project.designApprovedHours,
			recordings,
		).effectiveHours
		const build = rollUpHours(
			sessions.filter(s => s.themeProjectId === project.id && s.phase === Phase.BUILD),
			links.filter(l => l.themeProjectId === project.id && l.phase === Phase.BUILD),
			project.approvedHours,
			recordings,
		).effectiveHours
		return {
			buildStatus: project.buildStatus,
			buildWeek: def.buildWeek,
			designStatus: project.designStatus,
			designWeek: def.designWeek,
			grantUsd: project.grantUsd,
			hours: { build, design },
			id: project.id,
			label: def.label,
			slug: def.slug,
			theme: project.theme,
			tier: project.tier,
			title: project.title,
		}
	})

	// Program order, not insertion order.
	const ordered = items.toSorted((a, b) => a.designWeek - b.designWeek)
	return ok({ projects: ordered })
})

const createSchema = z.object({ weekId: z.number().int().min(1).max(10) }).strict()

/**
 * Create the project for a design week – called when its "create a project" checkpoint is opened, which is the only moment a project row is made (see lib/provisioning). Opening it again returns the same row.
 */
export const POST = withSession(async (req: Request, { gate }) => {
	const parsed = await parseBody(req, createSchema)
	if (parsed.error) return parsed.error

	const theme = themeForDesignWeek(parsed.data.weekId)
	if (!theme) return fail("VALIDATION_FAILED", "That week does not start a project")
	await assertWeekStarted(parsed.data.weekId)

	const project = await ensureThemeProject(gate.user.id, theme)
	return ok({ id: project.id }, { status: 201 })
})
