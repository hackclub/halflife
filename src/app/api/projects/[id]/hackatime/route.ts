import { after } from "next/server"
import { PhaseStatus } from "@/app/generated/prisma/enums"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { scheduledWeekFor } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import { requireSession } from "@/lib/guards"
import { fetchProjectSeconds } from "@/lib/hackatime"
import { warmLinkSpans } from "@/lib/hours"
import prisma from "@/lib/prisma"
import { assertWeekStarted, getSubmissionAccess, isPhaseDecided, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { hackatimeLinkSchema } from "@/lib/schemas/project"

type Params = { params: Promise<{ id: string }> }

export const GET = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const project = await prisma.themeProject.findFirst({
		include: { hackatimeLinks: true, user: { select: { hackatimeUserId: true } } },
		where: { deletedAt: null, id, userId: gate.user.id },
	})
	if (!project) return fail("NOT_FOUND", "Project not found")

	return ok({
		links: project.hackatimeLinks.map(l => ({
			cachedAt: l.cachedAt,
			hackatimeProject: l.hackatimeProject,
			hours: l.hoursApproved ?? (l.cachedSeconds ?? 0) / 3600,
			hoursApproved: l.hoursApproved,
			id: l.id,
			lastFetchError: l.lastFetchError,
			phase: l.phase,
		})),
	})
})

export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, hackatimeLinkSchema)
	if (parsed.error) return parsed.error

	const project = await prisma.themeProject.findFirst({
		include: { user: { select: { hackatimeUserId: true } } },
		where: { deletedAt: null, id, userId: gate.user.id },
	})
	if (!project) return fail("NOT_FOUND", "Project not found")

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

	await assertWeekStarted(scheduledWeekFor(project.theme, parsed.data.phase))

	// Linking adds hours to the phase, and the decision recomputes those hours live, so an in-review phase is frozen for this too – not only a decided one.
	const phaseStatus = parsed.data.phase === "DESIGN" ? project.designStatus : project.buildStatus
	if (phaseStatus === PhaseStatus.in_review)
		return fail("PHASE_LOCKED", "This phase is in review – unsubmit it before linking more hours")
	// A decided phase is frozen: linking a project adds hours to a number that has already been judged, so it waits for a return or an un-approval.
	if (isPhaseDecided(phaseStatus))
		return fail("PHASE_LOCKED", "This phase has been submitted and decided, so no more hours can be linked")

	if (!project.user.hackatimeUserId)
		return fail("HACKATIME_NOT_LINKED", "Link your Hackatime account before linking a project to it")

	const existing = await prisma.hackatimeLink.findUnique({
		where: {
			themeProjectId_hackatimeProject: {
				hackatimeProject: parsed.data.hackatimeProject,
				themeProjectId: id,
			},
		},
	})
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
			`That Hackatime project is already linked to ${where} of this project. One tracked project can back only one phase, because its hours are the project's whole total – unlink it there first, or link a different Hackatime project.`,
		)
	}

	const fetched = await fetchProjectSeconds(project.user.hackatimeUserId, parsed.data.hackatimeProject)
	// A name Hackatime does not list is a typo or a renamed project, not a link: creating it would leave a row that can never contribute hours and only surfaces again at approval time. A transient fetch failure still creates the link, so it can be refreshed once Hackatime answers.
	if (fetched.notFound) {
		return fail(
			"VALIDATION_FAILED",
			`Hackatime has no project named "${parsed.data.hackatimeProject}". Check the name on Hackatime and try again.`,
		)
	}

	const link = await prisma.$transaction(async tx => {
		// Re-read the phase on the transaction client immediately before the link lands: a submit that commits between the checks above and this create would otherwise attach hours to a phase the decision has already frozen.
		const current = await tx.themeProject.findUnique({
			select: { buildStatus: true, designStatus: true },
			where: { id },
		})
		const currentStatus = parsed.data.phase === "DESIGN" ? current?.designStatus : current?.buildStatus
		if (currentStatus === PhaseStatus.in_review)
			throw new HttpError("PHASE_LOCKED", "This phase is in review – unsubmit it before linking more hours")
		if (currentStatus && isPhaseDecided(currentStatus))
			throw new HttpError("PHASE_LOCKED", "This phase has been submitted and decided, so no more hours can be linked")

		return tx.hackatimeLink.create({
			data: {
				cachedAt: fetched.stale ? null : new Date(),
				cachedSeconds: fetched.stale ? null : fetched.seconds,
				hackatimeProject: parsed.data.hackatimeProject,
				lastFetchError: fetched.error ?? null,
				phase: parsed.data.phase,
				themeProjectId: id,
			},
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
	after(() => warmLinkSpans([{ ...link, cachedSpans: null, userId: project.userId }]))

	return ok({ link }, { status: 201 })
})
