import type { NextRequest } from "next/server"
import { after } from "next/server"
import { PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import { recomputeActiveDays, recomputeWeek } from "@/lib/analytics"
import { fail, ok, parseBody, parseQuery, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { scheduledWeekFor } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import { requireSession } from "@/lib/guards"
import { refreshOverlapSpans } from "@/lib/hours"
import { verifyOwnTimelapses } from "@/lib/lapse"
import { cursorArgs, pageResult, paginationQuery } from "@/lib/pagination"
import prisma from "@/lib/prisma"
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
import { isOwnedKey, publicUrlFor } from "@/lib/uploads/r2"
import { warmupPhaseOf } from "@/lib/warmup"

interface Params {
	params: Promise<{ id: string }>
}

export const GET = withRoute(async (req: NextRequest, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const query = parseQuery(req, paginationQuery)
	if (query.error) return query.error

	const project = await prisma.themeProject.findFirst({
		select: { id: true },
		where: { deletedAt: null, id, userId: gate.user.id },
	})
	if (!project) return fail("NOT_FOUND", "Project not found")

	const rows = await prisma.workSession.findMany({
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		where: { deletedAt: null, themeProjectId: id },
		...cursorArgs(query.data.cursor, query.data.limit),
		include: { media: true, timelapses: true },
	})

	const page = pageResult(rows, query.data.limit)
	return ok({
		items: page.items.map(s => ({
			...s,
			media: s.media.map(m => ({ ...m, url: publicUrlFor(m.objectKey) })),
		})),
		nextCursor: page.nextCursor,
	})
})

export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, sessionCreateSchema)
	if (parsed.error) return parsed.error
	const data = parsed.data

	const project = await prisma.themeProject.findFirst({
		where: { deletedAt: null, id, userId: gate.user.id },
	})
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

	const phaseStatus = data.phase === "DESIGN" ? project.designStatus : project.buildStatus
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
	const session = await prisma.$transaction(async tx => {
		if (lapseIds.length > 0) {
			// Sorted so two requests naming the same recordings cannot deadlock on each other's locks.
			for (const lapseId of [...lapseIds].sort()) {
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lapse:${lapseId}`}, 0))`
			}
			const taken = await tx.sessionTimelapse.findFirst({
				select: { externalId: true },
				where: {
					externalId: { in: lapseIds },
					provider: "lapse",
					workSession: { deletedAt: null, themeProject: { deletedAt: null } },
				},
			})
			if (taken) {
				const title = timelapses.find(t => t.id === taken.externalId)?.title ?? "That timelapse"
				throw new HttpError("CONFLICT", `"${title}" already backs another journal entry`)
			}
		}

		// The gates above are the fast fail; the phase and the week are re-read on the transaction client immediately before the write so a submit or a week that closes in between cannot file an entry into a frozen phase or a passed week.
		const current = await tx.themeProject.findUnique({
			select: { buildStatus: true, designStatus: true, submissionExtensionUntil: true },
			where: { id },
		})
		const currentStatus = data.phase === "DESIGN" ? current?.designStatus : current?.buildStatus
		if (currentStatus === PhaseStatus.in_review)
			throw new HttpError("PHASE_LOCKED", "This phase is in review – unsubmit before logging more work")
		if (currentStatus && isPhaseDecided(currentStatus))
			throw new HttpError("PHASE_LOCKED", "This phase has been submitted and decided, so new entries cannot be added")
		const weekUser = await tx.user.findUnique({
			select: { submissionExtensionUntil: true },
			where: { id: gate.user.id },
		})
		const settings = await getProgramSettings()
		const closesAt = effectiveWeekClose(
			weekClosesAt(settings, week),
			weekUser?.submissionExtensionUntil,
			current?.submissionExtensionUntil,
		)
		if (new Date() >= closesAt) throw new HttpError("WEEK_CLOSED", WEEK_CLOSED_MESSAGE)

		const created = await tx.workSession.create({
			data: {
				content: data.content ? sanitizeHtml(data.content) : null,
				effectiveDate: timing.effectiveDate,
				hoursClaimed: data.hoursClaimed,
				hoursSource: data.hoursSource,
				media: {
					create: data.media.map((m, i) => ({
						byteSize: m.byteSize ?? null,
						contentType: m.contentType ?? null,
						objectKey: m.objectKey,
						sortOrder: i,
						type: m.type,
					})),
				},
				phase: data.phase,
				themeProjectId: id,
				timelapses: {
					create: timelapses.map(t => ({
						// Lapse's duration is wall-clock time recorded, which is exactly what coverage is measured in.
						coveredSeconds: t.durationSeconds,
						externalId: t.id,
						hackatimeProject: t.hackatimeProject,
						playbackUrl: t.playbackUrl,
						provider: "lapse",
						// When it was recorded, and what Lapse saw on Hackatime while it ran. Together these are what stops one sitting being counted by this entry and again by the linked project.
						recordedAt: new Date(t.createdAt),
						thumbnailUrl: t.thumbnailUrl,
					})),
				},
				title: sanitize(data.title),
				weekNumber: timing.weekNumber,
			},
			include: { media: true, timelapses: true },
		})
		await recomputeStreak(tx, gate.user.id)
		return created
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
