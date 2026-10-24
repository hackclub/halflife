import { and, or } from "@prisma/orm-postgres/orm-client"
import { after } from "next/server"
import { Phase, PhaseStatus, type Theme } from "@/app/generated/prisma/enums"
import { recomputeActiveDays, recomputeWeek } from "@/lib/analytics"
import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { scheduledWeekFor } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withSession } from "@/lib/guards"
import { refreshOverlapSpans } from "@/lib/hours"
import { verifyOwnTimelapses } from "@/lib/lapse"
import { statusFor } from "@/lib/phase"
import db from "@/lib/prisma8"
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
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

interface Params {
	params: Promise<{ id: string; sessionId: string }>
}

/** Statuses in which a phase's entries may still be edited or deleted: a draft, or one an admin or reviewer sent back for changes. */
const EDITABLE_PHASE_STATUSES = [PhaseStatus.draft, PhaseStatus.update_requested]

function loadOwned(userId: string, projectId: string, sessionId: string) {
	return db.orm.public.WorkSession.where({ deletedAt: null, id: sessionId, themeProjectId: projectId })
		.where(session => session.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.eq(userId))))
		.include("themeProject", project => project.select("buildStatus", "designStatus", "theme"))
		.first()
}

/** A passed week's entries are the record it is judged on, so they stay put. */
function weekOpenFor(userId: string, projectId: string, session: { phase: Phase; themeProject: { theme: Theme } }) {
	return isWeekOpen(userId, projectId, scheduledWeekFor(session.themeProject.theme, session.phase))
}

export const PATCH = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id, sessionId } = await params

	const parsed = await parseBody(req, sessionUpdateSchema)
	if (parsed.error) return parsed.error
	const { data } = parsed

	const loaded = await loadOwned(gate.user.id, id, sessionId)
	if (!loaded?.themeProject) return fail("NOT_FOUND", "Session not found")
	const session = { ...loaded, themeProject: loaded.themeProject }
	const parseNullable = (value: string | null): Date | null => (value === null ? null : parseDbTimestamp(value))

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)
	if (!(await weekOpenFor(gate.user.id, id, session))) return fail("WEEK_CLOSED", WEEK_CLOSED_MESSAGE)

	// A submitted week's entries are what it was judged on, or is being judged on: in review, a reviewer is reading them; decided, they are the record the decision was made against. Only a week that is still open or has been sent back for changes can have its entries corrected.
	const phaseStatus = statusFor(session.themeProject, session.phase)
	if (phaseStatus === PhaseStatus.in_review)
		return fail("PHASE_LOCKED", "This week is in review – unsubmit it before editing its entries")
	if (isPhaseDecided(phaseStatus))
		return fail("PHASE_LOCKED", "This week has been submitted and decided, so its entries are final")

	// Once a reviewer has set hours on an entry, the participant editing it would silently invalidate the number the review was based on.
	if (session.hoursApproved !== null)
		return fail("PHASE_LOCKED", "This entry has been reviewed and can no longer be edited")

	// Timelapse re-attachment. `timelapses`, when present, is the full desired set of LAPSE clips: rows for ids already on this session are kept without re-verification, so a clip that went private since does not fail an unrelated words edit; brand-new ids go through the same ownership and single-use checks as creation; lapse rows for anything else come off. Ids naming this session's own older R2 uploads are kept silently – those rows predate Lapse and are never touched here.
	const rows = await db.orm.public.SessionTimelapse.where({ workSessionId: sessionId })
		.select("externalId", "id", "objectKey", "provider")
		.all()
	const r2Keys = new Set(rows.flatMap(r => (r.objectKey ? [r.objectKey] : [])))
	const have = new Set(rows.flatMap(r => (r.provider === "lapse" && r.externalId ? [r.externalId] : [])))
	const want =
		data.timelapses !== undefined
			? [...new Set(data.timelapses.map(t => t.lapseId).filter(lapseId => !r2Keys.has(lapseId)))]
			: null
	const addIds = want ? want.filter(lapseId => !have.has(lapseId)) : []
	// Same rule as creation, asked of Lapse rather than trusted from the sheet. Only brand-new ids are verified; everything already attached stays without a round trip. Verified for its side effects here (ownership, published, processed) and mapped to the shape the reconciler writes: `LapseTimelapse.createdAt` is epoch ms and becomes the recording's start, which is what makes this clip's wall-clock window comparable with Hackatime's tracked intervals.
	const fresh = (await verifyOwnTimelapses(gate.user.id, addIds)).map(t => ({
		durationSeconds: t.durationSeconds,
		hackatimeProject: t.hackatimeProject,
		id: t.id,
		playbackUrl: t.playbackUrl,
		recordedAt: t.createdAt,
		thumbnailUrl: t.thumbnailUrl,
		title: t.title,
	}))

	const updated = await db.transaction(async tx => {
		if (want !== null) await reconcileSessionTimelapses(tx, sessionId, want, fresh)
		// Conditional on the phase still being editable and the entry still unreviewed: a submit or a decision that commits between the checks above and this write makes it match nothing, and the edit is refused rather than landing on a frozen week.
		const changed = await tx.orm.public.WorkSession.where({ deletedAt: null, id: sessionId, themeProjectId: id })
			.where(session => session.hoursApproved.isNull())
			.where(session =>
				or(
					and(
						session.phase.eq(Phase.DESIGN),
						session.themeProject.some(project => project.designStatus.in(EDITABLE_PHASE_STATUSES)),
					),
					and(
						session.phase.eq(Phase.BUILD),
						session.themeProject.some(project => project.buildStatus.in(EDITABLE_PHASE_STATUSES)),
					),
				),
			)
			.updateAndCount({
				...(data.title !== undefined ? { title: sanitize(data.title) } : {}),
				...(data.content !== undefined ? { content: data.content ? sanitizeHtml(data.content) : null } : {}),
				...(data.hoursClaimed !== undefined ? { hoursClaimed: data.hoursClaimed } : {}),
				...(data.hoursSource !== undefined ? { hoursSource: data.hoursSource } : {}),
			})
		if (changed !== 1) throw new HttpError("PHASE_LOCKED", "This week moved while its entry was being edited")
		return tx.orm.public.WorkSession.whereUnique({ id: sessionId }).firstOrThrow()
	})

	await logAudit({
		action: AuditAction.USER_UPDATE_SESSION,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: {
			after: { hoursClaimed: updated.hoursClaimed, timelapses: want ?? [...have], title: updated.title },
			before: { hoursClaimed: session.hoursClaimed, timelapses: [...have], title: session.title },
		},
		targetId: sessionId,
		targetType: "WorkSession",
	})

	if (data.hoursClaimed !== undefined || data.hoursSource !== undefined || data.timelapses !== undefined)
		await recomputeWeek(gate.user.id, session.weekNumber)
	if (data.hoursClaimed !== undefined) await recomputeActiveDays(gate.user.id)

	// Attaching, dropping or swapping a recording moves the window Hackatime's hours are deduplicated against, so the cached spans covering it are refetched off the response path. `addIds` is the narrower truth for a pure reattach of clips already on this entry, but a removal narrows the window just as much, so the cache is warmed whenever the clip set was touched at all.
	if (want !== null) after(() => refreshOverlapSpans(id, session.phase))

	after(() => scheduleRepoSync(id))

	return ok({
		session: {
			...updated,
			createdAt: parseDbTimestamp(updated.createdAt),
			deletedAt: parseNullable(updated.deletedAt),
			reviewedAt: parseNullable(updated.reviewedAt),
		},
	})
})

export const DELETE = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id, sessionId } = await params

	const loadedDelete = await loadOwned(gate.user.id, id, sessionId)
	if (!loadedDelete?.themeProject) return fail("NOT_FOUND", "Session not found")
	const session = { ...loadedDelete, themeProject: loadedDelete.themeProject }

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

	if (session.hoursApproved !== null)
		return fail("PHASE_LOCKED", "This entry has been reviewed and can no longer be deleted")
	// Deleting an entry is a correction to the record, so it freezes with the phase: while a reviewer is reading the week, its evidence has to sit still, exactly as editing it does.
	const phaseStatus = statusFor(session.themeProject, session.phase)
	if (phaseStatus === PhaseStatus.in_review)
		return fail("PHASE_LOCKED", "This week is in review – unsubmit it before deleting its entries")
	// Once the week is decided its entries are final, exactly as editing is.
	if (isPhaseDecided(phaseStatus))
		return fail("PHASE_LOCKED", "This week has been submitted and decided, so its entries are final")
	if (!(await weekOpenFor(gate.user.id, id, session))) return fail("WEEK_CLOSED", WEEK_CLOSED_MESSAGE)

	// Deleting the only session on a day removes that day from the run, so the streak has to be recomputed with it. PATCH does not, because it cannot change `effectiveDate` – the set of journalled days is the same after it.
	await db.transaction(async tx => {
		// Conditional on the phase still being editable and the entry still unreviewed: a submit or a review that commits between the checks above and this write makes it match nothing, and the entry stays.
		const deleted = await tx.orm.public.WorkSession.where({ deletedAt: null, id: sessionId, themeProjectId: id })
			.where(session => session.hoursApproved.isNull())
			.where(session =>
				or(
					and(
						session.phase.eq(Phase.DESIGN),
						session.themeProject.some(project => project.designStatus.in(EDITABLE_PHASE_STATUSES)),
					),
					and(
						session.phase.eq(Phase.BUILD),
						session.themeProject.some(project => project.buildStatus.in(EDITABLE_PHASE_STATUSES)),
					),
				),
			)
			.updateAndCount({ deletedAt: formatDbTimestamp(new Date()) })
		if (deleted !== 1) throw new HttpError("PHASE_LOCKED", "This week moved while its entry was being deleted")
		await recomputeStreak(tx, gate.user.id)
	})

	await logAudit({
		action: AuditAction.USER_DELETE_SESSION,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { hoursClaimed: session.hoursClaimed, themeProjectId: id },
		targetId: sessionId,
		targetType: "WorkSession",
	})

	await recomputeWeek(gate.user.id, session.weekNumber)
	await recomputeActiveDays(gate.user.id)

	after(() => scheduleRepoSync(id))

	return ok({ ok: true })
})
