import { and } from "@prisma/orm-postgres/orm-client"
import { after, type NextRequest } from "next/server"
import { PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import { recomputeActiveDays, recomputeWeek } from "@/lib/analytics"
import { fail, ok, parseBody, parseQuery } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { scheduledWeekFor } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withSession } from "@/lib/guards"
import { refreshOverlapSpans } from "@/lib/hours"
import { verifyOwnTimelapses } from "@/lib/lapse"
import { lockKey } from "@/lib/locks"
import { decodeCursor, encodeCursor, paginationQuery } from "@/lib/pagination"
import { statusFor } from "@/lib/phase"
import db from "@/lib/prisma8"
import {
	assertWeekStarted,
	effectiveWeekClose,
	getProgramSettings,
	getSubmissionAccess,
	isPhaseDecided,
	isWeekOpen,
	SUBMISSIONS_CLOSED_MESSAGE,
	WEEK_CLOSED_MESSAGE,
	weekClosesAt,
} from "@/lib/program"
import { assertNoOwedReel } from "@/lib/reel-gate"
import { scheduleRepoSync } from "@/lib/repo-sync"
import { sanitize, sanitizeHtml } from "@/lib/sanitize"
import { sessionCreateSchema } from "@/lib/schemas/session"
import { recomputeStreak } from "@/lib/streak"
import { stampSessionTiming } from "@/lib/submissions"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"
import { isOwnedKey, publicUrlFor } from "@/lib/uploads/r2"
import { warmupPhaseOf } from "@/lib/warmup"

interface Params {
	params: Promise<{ id: string }>
}

export const dynamic = "force-dynamic"

/** The entries' order: newest first, with the id as the tiebreaker. Cursor pages carry both halves of that position, so a page boundary never drops an entry or hands one out twice. */
const parseSessionDates = <T extends { createdAt: string; deletedAt: string | null; reviewedAt: string | null }>(
	session: T,
): Omit<T, "createdAt" | "deletedAt" | "reviewedAt"> & {
	createdAt: Date
	deletedAt: Date | null
	reviewedAt: Date | null
} => ({
	...session,
	createdAt: parseDbTimestamp(session.createdAt),
	deletedAt: session.deletedAt === null ? null : parseDbTimestamp(session.deletedAt),
	reviewedAt: session.reviewedAt === null ? null : parseDbTimestamp(session.reviewedAt),
})

export const GET = withSession(async (req: NextRequest, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const query = parseQuery(req, paginationQuery)
	if (query.error) return query.error

	const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
		.select("id")
		.first()
	if (!project) return fail("NOT_FOUND", "Project not found")

	const filtered = db.orm.public.WorkSession.where({ deletedAt: null, themeProjectId: id }).orderBy([
		session => session.createdAt.desc(),
		session => session.id.desc(),
	])
	// Only the API reads this list, so a cursor that is not one of ours is a bad request rather than a page to fall back to.
	const position = query.data.cursor === undefined ? null : decodeCursor(query.data.cursor)
	const rows = await (position?.at
		? filtered.cursor({ createdAt: formatDbTimestamp(position.at), id: position.id })
		: filtered
	)
		.limit(query.data.limit + 1)
		.include("media")
		.include("timelapses")
		.all()
	const items = rows.slice(0, query.data.limit)
	const last = items.at(-1)
	return ok({
		items: items.map(s => ({
			...parseSessionDates(s),
			media: s.media.map(m => ({
				...m,
				createdAt: parseDbTimestamp(m.createdAt),
				url: publicUrlFor(m.objectKey),
			})),
			timelapses: s.timelapses.map(t => ({
				...t,
				createdAt: parseDbTimestamp(t.createdAt),
				recordedAt: t.recordedAt === null ? null : parseDbTimestamp(t.recordedAt),
			})),
		})),
		nextCursor:
			rows.length > query.data.limit && last
				? encodeCursor({ at: parseDbTimestamp(last.createdAt), id: last.id })
				: null,
	})
})

export const POST = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, sessionCreateSchema)
	if (parsed.error) return parsed.error
	const { data } = parsed

	const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id }).first()
	if (!project) return fail("NOT_FOUND", "Project not found")

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

	// A new entry completes a checkpoint, so a deleted reel still owed holds it.
	await assertNoOwedReel(gate.user.id)

	if (project.theme === Theme.WARMUP && data.phase !== warmupPhaseOf(project))
		return fail("VALIDATION_FAILED", "Entries on a warm-up project go on the phase it is submitted as")

	const week = scheduledWeekFor(project.theme, data.phase)
	await assertWeekStarted(week)
	if (!(await isWeekOpen(gate.user.id, id, week))) return fail("WEEK_CLOSED", WEEK_CLOSED_MESSAGE)

	const phaseStatus = statusFor(project, data.phase)
	if (phaseStatus === PhaseStatus.in_review)
		return fail("PHASE_LOCKED", "This phase is in review – unsubmit before logging more work")
	// Same rule as editing an entry: once a week is decided, its entries are the record the decision was made against. Without this, hours could be logged after approval and paid out on the next un-approve/re-approve cycle.
	if (isPhaseDecided(phaseStatus))
		return fail("PHASE_LOCKED", "This phase has been submitted and decided, so new entries cannot be added")

	// Evidence has to be the claimant's own. Keys are not secrets – the feed hands out a full video URL for every reel – so without this someone could attach a stranger's timelapse as proof of hours they did not work, which is the one thing the timelapse rule exists to make hard.
	//
	// Rejected rather than quietly dropped: a participant who thinks they attached a clip and finds it missing at review has been failed silently.
	const foreign = data.media.map(m => m.objectKey).filter(key => !isOwnedKey(gate.user.id, key))
	if (foreign.length > 0) return fail("VALIDATION_FAILED", "Those uploads are not yours")

	// Timelapses are the same rule asked of Lapse: each must be the caller's own, published, and done processing. And one recording backs one session – otherwise the same footage could be offered as proof twice. That check is read-then-create, so it happens inside the transaction under a lock on the recording; two parallel submits of the same clip otherwise both pass it.
	const lapseIds = [...new Set(data.timelapses.map(t => t.lapseId))]
	const timelapses = await verifyOwnTimelapses(gate.user.id, lapseIds)

	const timing = await stampSessionTiming(new Date())

	// One transaction: a session and the streak it feeds have to land together, or a rolled-back write leaves an inflated streak with nothing behind it.
	const session = await db.transaction(async tx => {
		if (lapseIds.length > 0) {
			// Sorted so two requests naming the same recordings cannot deadlock on each other's locks.
			for (const lapseId of [...lapseIds].toSorted()) await lockKey(tx, `lapse:${lapseId}`)

			const taken = await tx.orm.public.SessionTimelapse.where({ provider: "lapse" })
				.where(timelapse => timelapse.externalId.in(lapseIds))
				.where(timelapse =>
					timelapse.workSession.some(session =>
						and(
							session.deletedAt.isNull(),
							session.themeProject.some(project => project.deletedAt.isNull()),
						),
					),
				)
				.select("externalId")
				.first()
			if (taken) {
				const title = timelapses.find(t => t.id === taken.externalId)?.title ?? "That timelapse"
				throw new HttpError("CONFLICT", `"${title}" already backs another journal entry`)
			}
		}

		// The gates above are the fast fail; the phase and the week are re-read on the transaction client immediately before the write so a submit or a week that closes in between cannot file an entry into a frozen phase or a passed week.
		const current = await tx.orm.public.ThemeProject.whereUnique({ id })
			.select("buildStatus", "designStatus", "submissionExtensionUntil")
			.first()
		const currentStatus = current ? statusFor(current, data.phase) : undefined
		if (currentStatus === PhaseStatus.in_review)
			throw new HttpError("PHASE_LOCKED", "This phase is in review – unsubmit before logging more work")
		if (currentStatus && isPhaseDecided(currentStatus))
			throw new HttpError("PHASE_LOCKED", "This phase has been submitted and decided, so new entries cannot be added")
		const weekUser = await tx.orm.public.User.whereUnique({ id: gate.user.id })
			.select("submissionExtensionUntil")
			.first()
		const settings = await getProgramSettings()
		const closesAt = effectiveWeekClose(
			weekClosesAt(settings, week),
			weekUser?.submissionExtensionUntil ? parseDbTimestamp(weekUser.submissionExtensionUntil) : null,
			current?.submissionExtensionUntil ? parseDbTimestamp(current.submissionExtensionUntil) : null,
		)
		if (new Date() >= closesAt) throw new HttpError("WEEK_CLOSED", WEEK_CLOSED_MESSAGE)

		const created = await tx.orm.public.WorkSession.create({
			content: data.content ? sanitizeHtml(data.content) : null,
			effectiveDate: timing.effectiveDate,
			hoursClaimed: data.hoursClaimed,
			hoursSource: data.hoursSource,
			phase: data.phase,
			themeProjectId: id,
			title: sanitize(data.title),
			weekNumber: timing.weekNumber,
		})
		if (data.media.length > 0)
			await tx.orm.public.SessionMedia.createAll(
				data.media.map((m, i) => ({
					byteSize: m.byteSize ?? null,
					contentType: m.contentType ?? null,
					objectKey: m.objectKey,
					sortOrder: i,
					type: m.type,
					workSessionId: created.id,
				})),
			)
		if (timelapses.length > 0)
			await tx.orm.public.SessionTimelapse.createAll(
				timelapses.map(t => ({
					// Lapse's duration is wall-clock time recorded, which is exactly what coverage is measured in.
					coveredSeconds: t.durationSeconds,
					externalId: t.id,
					hackatimeProject: t.hackatimeProject,
					playbackUrl: t.playbackUrl,
					provider: "lapse",
					// When it was recorded, and what Lapse saw on Hackatime while it ran. Together these are what stops one sitting being counted by this entry and again by the linked project.
					recordedAt: formatDbTimestamp(new Date(t.createdAt)),
					thumbnailUrl: t.thumbnailUrl,
					workSessionId: created.id,
				})),
			)
		await recomputeStreak(tx, gate.user.id)
		const full = await tx.orm.public.WorkSession.whereUnique({ id: created.id })
			.include("media")
			.include("timelapses")
			.firstOrThrow()
		return { ...full, media: full.media ?? [], timelapses: full.timelapses ?? [] }
	})

	await logAudit({
		action: AuditAction.USER_CREATE_SESSION,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: {
			hoursClaimed: data.hoursClaimed,
			hoursSource: data.hoursSource,
			phase: data.phase,
			themeProjectId: id,
		},
		targetId: session.id,
		targetType: "WorkSession",
	})

	await recomputeWeek(gate.user.id, session.weekNumber)
	await recomputeActiveDays(gate.user.id)

	// The new entry lands in the repo, after this response has gone out. The scheduling read is cheap and no-ops for a project with the sync off.
	after(() => scheduleRepoSync(id))

	// Same reasoning, for the overlap cache: a recording just widened the window the Hackatime hours are deduplicated against, so the spans covering it are fetched here rather than at approval – where the reviewer would otherwise see one Hackatime total and approve a different one.
	if (timelapses.length > 0) after(() => refreshOverlapSpans(id, data.phase))

	return ok({ session }, { status: 201 })
})
