import { after } from "next/server"
import { type Phase, PhaseStatus, type Theme } from "@/app/generated/prisma/enums"
import { recomputeWeek } from "@/lib/analytics"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { scheduledWeekFor } from "@/lib/config/program"
import { requireSession } from "@/lib/guards"
import { verifyOwnTimelapses } from "@/lib/lapse"
import prisma from "@/lib/prisma"
import {
	getSubmissionAccess,
	isPhaseDecided,
	isWeekOpen,
	SUBMISSIONS_CLOSED_MESSAGE,
	WEEK_CLOSED_MESSAGE,
} from "@/lib/program"
import { scheduleRepoSync } from "@/lib/repo-sync"
import { sanitize, sanitizeHtml } from "@/lib/sanitize"
import { sessionUpdateSchema } from "@/lib/schemas/session"
import { reconcileSessionTimelapses } from "@/lib/session-timelapses"
import { recomputeStreak } from "@/lib/streak"

type Params = { params: Promise<{ id: string; sessionId: string }> }

async function loadOwned(userId: string, projectId: string, sessionId: string) {
	return prisma.workSession.findFirst({
		where: {
			id: sessionId,
			themeProjectId: projectId,
			deletedAt: null,
			themeProject: { userId, deletedAt: null },
		},
		include: { themeProject: { select: { theme: true, designStatus: true, buildStatus: true } } },
	})
}

/** A passed week's entries are the record it is judged on, so they stay put. */
function weekOpenFor(userId: string, projectId: string, session: { phase: Phase; themeProject: { theme: Theme } }) {
	return isWeekOpen(userId, projectId, scheduledWeekFor(session.themeProject.theme, session.phase))
}

export const PATCH = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id, sessionId } = await params

	const parsed = await parseBody(req, sessionUpdateSchema)
	if (parsed.error) return parsed.error
	const data = parsed.data

	const session = await loadOwned(gate.user.id, id, sessionId)
	if (!session) return fail("NOT_FOUND", "Session not found")

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)
	if (!(await weekOpenFor(gate.user.id, id, session))) return fail("WEEK_CLOSED", WEEK_CLOSED_MESSAGE)

	// A submitted week's entries are what it was judged on, or is being judged
	// on: in review, a reviewer is reading them; decided, they are the record
	// the decision was made against. Only a week that is still open or has been
	// sent back for changes can have its entries corrected.
	const phaseStatus = session.phase === "DESIGN" ? session.themeProject.designStatus : session.themeProject.buildStatus
	if (phaseStatus === PhaseStatus.in_review) {
		return fail("PHASE_LOCKED", "This week is in review — unsubmit it before editing its entries")
	}
	if (isPhaseDecided(phaseStatus)) {
		return fail("PHASE_LOCKED", "This week has been submitted and decided, so its entries are final")
	}

	// Once a reviewer has set hours on an entry, the participant editing it
	// would silently invalidate the number the review was based on.
	if (session.hoursApproved !== null) {
		return fail("PHASE_LOCKED", "This entry has been reviewed and can no longer be edited")
	}

	// Timelapse re-attachment. `timelapses`, when present, is the full desired
	// set of LAPSE clips: rows for ids already on this session are kept without
	// re-verification, so a clip that went private since does not fail an
	// unrelated words edit; brand-new ids go through the same ownership and
	// single-use checks as creation; lapse rows for anything else come off.
	// Ids naming this session's own older R2 uploads are kept silently — those
	// rows predate Lapse and are never touched here.
	const rows = await prisma.sessionTimelapse.findMany({
		where: { workSessionId: sessionId },
		select: { id: true, provider: true, externalId: true, objectKey: true },
	})
	const r2Keys = new Set(rows.flatMap((r) => (r.objectKey ? [r.objectKey] : [])))
	const have = new Set(rows.flatMap((r) => (r.provider === "lapse" && r.externalId ? [r.externalId] : [])))
	const want =
		data.timelapses !== undefined
			? [...new Set(data.timelapses.map((t) => t.lapseId).filter((id) => !r2Keys.has(id)))]
			: null
	const addIds = want ? want.filter((id) => !have.has(id)) : []
	// Same rule as creation, asked of Lapse rather than trusted from the sheet.
	// Only brand-new ids are verified; everything already attached stays
	// without a round trip.
	const fresh = await verifyOwnTimelapses(gate.user.id, addIds)

	const updated = await prisma.$transaction(async (tx) => {
		if (want !== null) await reconcileSessionTimelapses(tx, sessionId, want, fresh)
		return tx.workSession.update({
			where: { id: sessionId },
			data: {
				...(data.title !== undefined ? { title: sanitize(data.title) } : {}),
				...(data.content !== undefined ? { content: data.content ? sanitizeHtml(data.content) : null } : {}),
				...(data.hoursClaimed !== undefined ? { hoursClaimed: data.hoursClaimed } : {}),
				...(data.hoursSource !== undefined ? { hoursSource: data.hoursSource } : {}),
			},
		})
	})

	await logAudit({
		action: AuditAction.USER_UPDATE_SESSION,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "WorkSession",
		targetId: sessionId,
		metadata: {
			before: { hoursClaimed: session.hoursClaimed, title: session.title, timelapses: [...have] },
			after: { hoursClaimed: updated.hoursClaimed, title: updated.title, timelapses: want ?? [...have] },
		},
	})

	if (data.hoursClaimed !== undefined || data.hoursSource !== undefined || data.timelapses !== undefined) {
		await recomputeWeek(gate.user.id, session.weekNumber)
	}

	after(() => scheduleRepoSync(id))

	return ok({ session: updated })
})

export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id, sessionId } = await params

	const session = await loadOwned(gate.user.id, id, sessionId)
	if (!session) return fail("NOT_FOUND", "Session not found")

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

	if (session.hoursApproved !== null) {
		return fail("PHASE_LOCKED", "This entry has been reviewed and can no longer be deleted")
	}
	// Deleting an entry is a correction to the record, so it freezes with the
	// phase: while a reviewer is reading the week, its evidence has to sit
	// still, exactly as editing it does.
	const phaseStatus = session.phase === "DESIGN" ? session.themeProject.designStatus : session.themeProject.buildStatus
	if (phaseStatus === PhaseStatus.in_review) {
		return fail("PHASE_LOCKED", "This week is in review — unsubmit it before deleting its entries")
	}
	// Once the week is decided its entries are final, exactly as editing is.
	if (isPhaseDecided(phaseStatus)) {
		return fail("PHASE_LOCKED", "This week has been submitted and decided, so its entries are final")
	}
	if (!(await weekOpenFor(gate.user.id, id, session))) return fail("WEEK_CLOSED", WEEK_CLOSED_MESSAGE)

	// Deleting the only session on a day removes that day from the run, so the
	// streak has to be recomputed with it. PATCH does not, because it cannot
	// change `effectiveDate` — the set of journalled days is the same after it.
	await prisma.$transaction(async (tx) => {
		await tx.workSession.update({
			where: { id: sessionId },
			data: { deletedAt: new Date() },
		})
		await recomputeStreak(tx, gate.user.id)
	})

	await logAudit({
		action: AuditAction.USER_DELETE_SESSION,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "WorkSession",
		targetId: sessionId,
		metadata: { themeProjectId: id, hoursClaimed: session.hoursClaimed },
	})

	await recomputeWeek(gate.user.id, session.weekNumber)

	after(() => scheduleRepoSync(id))

	return ok({ ok: true })
})
