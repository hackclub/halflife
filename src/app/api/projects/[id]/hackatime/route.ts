import { and } from "@prisma/orm-postgres/orm-client"
import { after } from "next/server"
import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { projectDisplayTitle, scheduledWeekFor } from "@/lib/config/program"
import { PhaseStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withSession } from "@/lib/guards"
import { fetchProjectSeconds, phaseWeekWindow } from "@/lib/hackatime"
import { warmLinkSpans } from "@/lib/hours"
import { statusFor } from "@/lib/phase"
import db from "@/lib/prisma8"
import { assertWeekStarted, getSubmissionAccess, isPhaseDecided, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { hackatimeLinkSchema } from "@/lib/schemas/project"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

interface Params {
	params: Promise<{ id: string }>
}

export const dynamic = "force-dynamic"

export const GET = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
		.include("hackatimeLinks")
		.include("user", user => user.select("hackatimeUserId"))
		.first()
	if (!project?.user) return fail("NOT_FOUND", "Project not found")

	return ok({
		links: project.hackatimeLinks.map(l => ({
			cachedAt: l.cachedAt ? parseDbTimestamp(l.cachedAt).toISOString() : null,
			hackatimeProject: l.hackatimeProject,
			hours: l.hoursApproved ?? (l.cachedSeconds ?? 0) / 3600,
			hoursApproved: l.hoursApproved,
			id: l.id,
			lastFetchError: l.lastFetchError,
			phase: l.phase,
		})),
	})
})

export const POST = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, hackatimeLinkSchema)
	if (parsed.error) return parsed.error

	const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
		.include("user", user => user.select("hackatimeUserId"))
		.first()
	if (!project?.user) return fail("NOT_FOUND", "Project not found")

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

	await assertWeekStarted(scheduledWeekFor(project.theme, parsed.data.phase))

	// Linking adds hours to the phase, and the decision recomputes those hours live, so an in-review phase is frozen for this too – not only a decided one.
	const phaseStatus = statusFor(project, parsed.data.phase)
	if (phaseStatus === PhaseStatus.in_review)
		return fail("PHASE_LOCKED", "This phase is in review, so unsubmit it before linking more hours")
	// A decided phase is frozen: linking a project adds hours to a number that has already been judged, so it waits for a return or an un-approval.
	if (isPhaseDecided(phaseStatus))
		return fail("PHASE_LOCKED", "This phase has been submitted and decided, so no more hours can be linked")

	if (!project.user.hackatimeUserId)
		return fail("HACKATIME_NOT_LINKED", "Link your Hackatime account before linking a project to it")

	const existing = await db.orm.public.HackatimeLink.where({
		hackatimeProject: parsed.data.hackatimeProject,
		themeProjectId: id,
	}).first()
	if (existing) {
		// Cross-phase on purpose: Hackatime reports the project's whole total, so linking it for both phases would count the same tracked time twice.
		const where =
			existing.phase === parsed.data.phase
				? "this phase"
				: existing.phase === "DESIGN"
					? "the design phase"
					: "the build phase"
		return fail(
			"CONFLICT",
			`That Hackatime project is already linked to ${where} of this project. One tracked project can back only one phase, because its hours are the project's whole total. Unlink it there first, or link a different Hackatime project.`,
		)
	}

	// Cross-project on purpose: one block of tracked time backing two of the maker's projects counts it twice, at a $100 grant plus up to 250 coins a project. Week-scoping (below) separates themes in different scheduled weeks, but warm-ups have no week and an unscoped warm-up total otherwise swallows a theme week's hours whole – so the same tracked project may back only one project, full stop. Deleted projects are excluded: their links stop counting with them.
	const other = await db.orm.public.HackatimeLink.where({ hackatimeProject: parsed.data.hackatimeProject })
		.where(link =>
			link.themeProject.some(owner =>
				and(owner.deletedAt.isNull(), owner.userId.eq(gate.user.id), owner.id.neq(id)),
			),
		)
		.include("themeProject", owner => owner.select("theme", "title"))
		.first()
	if (other?.themeProject)
		return fail(
			"CONFLICT",
			`That Hackatime project is already linked to "${projectDisplayTitle(other.themeProject)}". One tracked project can back only one project, because its hours would otherwise count twice. Unlink it there first, or link a different Hackatime project.`,
		)

	// Scoped to the phase's scheduled week: the endpoint's default is the project's all-time total, and linking that total on every theme and warm-up paid one block of work many times over. Warm-ups (week 0) have no week to scope to and keep the all-time total, with the cross-project check above as the guard.
	const window = await phaseWeekWindow(project.theme, parsed.data.phase)
	const fetched = await fetchProjectSeconds(
		project.user.hackatimeUserId,
		parsed.data.hackatimeProject,
		window ?? undefined,
	)
	// A name Hackatime does not list is a typo or a renamed project, not a link: creating it would leave a row that can never contribute hours and only surfaces again at approval time. A transient fetch failure still creates the link, so it can be refreshed once Hackatime answers.
	if (fetched.notFound)
		return fail(
			"VALIDATION_FAILED",
			`Hackatime has no project named "${parsed.data.hackatimeProject}". Check the name on Hackatime and try again.`,
		)

	const link = await db.transaction(async tx => {
		// Re-read the phase on the transaction client immediately before the link lands: a submit that commits between the checks above and this create would otherwise attach hours to a phase the decision has already frozen.
		const current = await tx.orm.public.ThemeProject.whereUnique({ id }).select("buildStatus", "designStatus").first()
		const currentStatus = current ? statusFor(current, parsed.data.phase) : undefined
		if (currentStatus === PhaseStatus.in_review)
			throw new HttpError("PHASE_LOCKED", "This phase is in review, so unsubmit it before linking more hours")
		if (currentStatus && isPhaseDecided(currentStatus))
			throw new HttpError("PHASE_LOCKED", "This phase has been submitted and decided, so no more hours can be linked")

		// Re-checked inside the transaction: a link of the same tracked project to another of the maker's projects, landing between the checks above and this create, would otherwise count one block of time twice.
		const clash = await tx.orm.public.HackatimeLink.where({ hackatimeProject: parsed.data.hackatimeProject })
			.where(link =>
				link.themeProject.some(owner =>
					and(owner.deletedAt.isNull(), owner.userId.eq(gate.user.id), owner.id.neq(id)),
				),
			)
			.first()
		if (clash)
			throw new HttpError(
				"CONFLICT",
				"That Hackatime project was just linked to another of your projects. Unlink it there first, or link a different Hackatime project.",
			)

		return tx.orm.public.HackatimeLink.create({
			cachedAt: fetched.stale ? null : formatDbTimestamp(new Date()),
			cachedSeconds: fetched.stale ? null : fetched.seconds,
			hackatimeProject: parsed.data.hackatimeProject,
			lastFetchError: fetched.error ?? null,
			phase: parsed.data.phase,
			themeProjectId: id,
		})
	})

	await logAudit({
		action: AuditAction.USER_LINK_HACKATIME,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { hackatimeProject: parsed.data.hackatimeProject, themeProjectId: id },
		targetId: link.id,
		targetType: "HackatimeLink",
	})

	// The tracked intervals, warmed as the link lands rather than left to the next scheduled run. Linking is the moment a phase starts showing Hackatime hours, and for up to a quarter of an hour after it the phase would show the link's whole total with no recording overlap taken off – the same inflated figure this whole path exists to prevent, arriving at exactly the moment someone is looking at it. Off the response path, and swallowed: a failed warm is the cold cache the sync will retry.
	after(() =>
		warmLinkSpans([
			{
				cachedSpans: null,
				hackatimeProject: link.hackatimeProject,
				id: link.id,
				phase: link.phase,
				themeProjectId: link.themeProjectId,
				userId: project.userId,
			},
		]),
	)

	return ok({ link }, { status: 201 })
})
