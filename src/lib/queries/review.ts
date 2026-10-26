import "server-only"
import { and } from "@prisma/orm-postgres/orm-client"
import { getThemeDef, projectDisplayTitle } from "@/lib/config/program"
import { displayName } from "@/lib/display-name"
import { Phase } from "@/lib/enums"
import { getHoursBreakdown, type HoursBreakdown } from "@/lib/hours"
import { encodeCursor, readCursor } from "@/lib/pagination"
import db from "@/lib/prisma8"
import { formatDbTimestamp, parseDbTimestamp, parseTimestampFields } from "@/lib/time"
import { publicUrlFor } from "@/lib/uploads/r2"

export interface QueueItem {
	claimExpiresAt: Date | null
	claimedBy: { id: string; name: string | null } | null
	/** Whether the claim is still in force. Computed here rather than in a
	 *
	 * *  component, so rendering stays a pure function of its inputs.
	 */
	claimLive: boolean
	id: string
	onTime: boolean
	// Display name only – the queue is open to every REVIEWER, so maker emails must not be scrapable page by page (M6).
	participant: { id: string; name: string | null }
	phase: Phase
	projectTitle: string
	submittedAt: Date
	submittedInWeek: number | null
	themeLabel: string
	themeProjectId: string
	tier: number | null
}

export async function getReviewQueue(opts: {
	/** The signed-in reviewer. Their own submissions are excluded from the queue. */
	reviewerId: string
	phase?: Phase
	cursor?: string
	limit: number
}): Promise<{ items: QueueItem[]; nextCursor: string | null; counts: { design: number; build: number } }> {
	const base = db.orm.public.PhaseSubmission.where({ resolvedAt: null }).where(submission =>
		// Nobody reviews their own work, so it should never show up as something to act on. The decision path refuses it too – this is so the queue counts are honest, not the enforcement.
		submission.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.neq(opts.reviewerId))),
	)
	const filtered = opts.phase ? base.where({ phase: opts.phase }) : base
	const position = readCursor(opts.cursor)
	// Oldest first: a review queue that surfaces the newest work leaves the people who submitted first waiting longest.
	const ordered = filtered.orderBy([submission => submission.createdAt.asc(), submission => submission.id.asc()])
	// The queue is rendered as a page as well as served as an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
	const paged = position?.at ? ordered.cursor({ createdAt: formatDbTimestamp(position.at), id: position.id }) : ordered
	const [rows, design, build] = await Promise.all([
		paged
			.limit(opts.limit + 1)
			.include("claim", claim =>
				claim.select("expiresAt").include("reviewer", reviewer => reviewer.select("displayName", "id", "name")),
			)
			.include("themeProject", project =>
				project
					.select("id", "theme", "tier", "title")
					.include("user", user => user.select("displayName", "id", "name")),
			)
			.all(),
		filtered.where({ phase: Phase.DESIGN }).aggregate(a => ({ count: a.count() })),
		filtered.where({ phase: Phase.BUILD }).aggregate(a => ({ count: a.count() })),
	])

	const items = rows.slice(0, opts.limit)
	const last = items.at(-1)
	const now = Date.now()

	return {
		counts: { build: build.count, design: design.count },
		items: items.map(row => {
			const project = row.themeProject
			if (!project) throw new Error(`submission ${row.id} has no project`)
			const { user } = project
			if (!user) throw new Error(`submission ${row.id} has no author`)
			const reviewer = row.claim?.reviewer ?? null
			if (row.claim && !reviewer) throw new Error(`submission ${row.id} has a claim with no reviewer`)
			const expiresAt = row.claim ? parseDbTimestamp(row.claim.expiresAt) : null
			return {
				claimExpiresAt: expiresAt,
				claimedBy: reviewer ? { id: reviewer.id, name: displayName(reviewer) } : null,
				claimLive: expiresAt !== null && expiresAt.getTime() > now,
				id: row.id,
				onTime: row.onTime,
				participant: { id: user.id, name: displayName(user) },
				phase: row.phase,
				projectTitle: project.title,
				submittedAt: parseDbTimestamp(row.createdAt),
				submittedInWeek: row.submittedInWeek,
				themeLabel: getThemeDef(project.theme).label,
				themeProjectId: project.id,
				tier: project.tier,
			}
		}),
		nextCursor:
			rows.length > opts.limit && last ? encodeCursor({ at: parseDbTimestamp(last.createdAt), id: last.id }) : null,
	}
}

/** The detail page's submission row, with every timestamp column parsed and the include tree loaded. */
const loadSubmissionDetail = (submissionId: string) =>
	db.orm.public.PhaseSubmission.whereUnique({ id: submissionId })
		.include("claim", claim => claim.include("reviewer", reviewer => reviewer.select("displayName", "id", "name")))
		.include("dispute", dispute =>
			dispute.include("messages", messages =>
				messages
					.include("author", author => author.select("displayName", "id", "name"))
					.orderBy(message => message.createdAt.asc()),
			),
		)
		.include("reviews", reviews =>
			reviews
				.include("reviewer", reviewer => reviewer.select("displayName", "id", "name"))
				.orderBy(review => review.createdAt.desc()),
		)
		.include("themeProject", project =>
			project.include("user", user =>
				user.select("displayName", "email", "fraudFlagged", "id", "name", "slackId", "verificationStatus"),
			),
		)
		.first()

const loadSessions = (phase: Phase, themeProjectId: string) =>
	db.orm.public.WorkSession.where({ deletedAt: null, phase, themeProjectId })
		.include("media")
		.include("timelapses")
		.orderBy(session => session.createdAt.asc())
		.all()

const loadLinks = (phase: Phase, themeProjectId: string) =>
	db.orm.public.HackatimeLink.where({ phase, themeProjectId }).all()

const loadPriorReviews = (themeProjectId: string) =>
	db.orm.public.SubmissionReview.where(review =>
		review.submission.some(submission => submission.themeProjectId.eq(themeProjectId)),
	)
		.include("reviewer", reviewer => reviewer.select("displayName", "name"))
		.include("submission", submission => submission.select("phase"))
		.orderBy(review => review.createdAt.desc())
		.limit(20)
		.all()

type SubmissionRow = NonNullable<Awaited<ReturnType<typeof loadSubmissionDetail>>>
type SessionRow = Awaited<ReturnType<typeof loadSessions>>[number]
type LinkRow = Awaited<ReturnType<typeof loadLinks>>[number]
type PriorReviewRow = Awaited<ReturnType<typeof loadPriorReviews>>[number]

const parseSessionRow = (row: SessionRow) => {
	const parsed = parseTimestampFields(row, ["createdAt", "deletedAt", "reviewedAt", "updatedAt"])
	return {
		...parsed,
		media: row.media.map(media => {
			const mediaRow = parseTimestampFields(media, ["createdAt"])
			return { ...mediaRow, url: publicUrlFor(media.objectKey) }
		}),
		timelapses: row.timelapses.map(timelapse => parseTimestampFields(timelapse, ["createdAt", "recordedAt"])),
	}
}

const parseLinkRow = (row: LinkRow) =>
	parseTimestampFields(row, ["cachedAt", "createdAt", "reviewedAt", "spansFetchedAt"])

const parsePriorReviewRow = (row: PriorReviewRow) => {
	const { submission } = row
	if (!submission) throw new Error(`review ${row.id} has no submission`)
	return { ...parseTimestampFields(row, ["createdAt", "invalidatedAt"]), submission }
}

const parseSubmissionRow = (row: SubmissionRow) =>
	parseTimestampFields(
		{
			...row,
			claim: row.claim ? parseTimestampFields(row.claim, ["createdAt", "expiresAt"]) : null,
			dispute: row.dispute
				? parseTimestampFields(
						{
							...row.dispute,
							messages: row.dispute.messages.map(message => parseTimestampFields(message, ["createdAt"])),
						},
						["createdAt", "resolvedAt"],
					)
				: null,
			reviews: row.reviews.map(review => parseTimestampFields(review, ["createdAt", "invalidatedAt"])),
			themeProject: row.themeProject
				? parseTimestampFields(row.themeProject, [
						"approvedHoursAt",
						"buildReviewedAt",
						"createdAt",
						"deletedAt",
						"designApprovedHoursAt",
						"designReviewedAt",
						"grantEmittedAt",
						"namedAt",
						"repoSyncQueuedAt",
						"repoSyncedAt",
						"submissionExtensionUntil",
						"updatedAt",
					])
				: null,
		},
		["ariStatusAt", "ariSyncedAt", "createdAt", "preReviewedAt", "resolvedAt"],
	)

type ParsedSubmission = ReturnType<typeof parseSubmissionRow>
type ParsedProject = NonNullable<ParsedSubmission["themeProject"]>
type ParsedMaker = NonNullable<ParsedProject["user"]>

/**
 * The submission row with everything its review page renders: project, maker, claim, dispute and reviews.
 *
 * `themeProject` and its `user` are non-null here: the loader returns null for a submission without either, so a caller that got a detail has both.
 */
export type SubmissionDetail = Omit<ParsedSubmission, "themeProject"> & {
	themeProject: Omit<ParsedProject, "user"> & { user: ParsedMaker }
}

/** A devlog session with its evidence resolved to URLs for the review page. */
export type ReviewSession = ReturnType<typeof parseSessionRow>

/** A prior decision on any of the project's submissions: who wrote it and which phase it decided. */
export type PriorReview = ReturnType<typeof parsePriorReviewRow>

/** A Hackatime link on the submission's project, with its cache timestamps parsed. */
export type ReviewLink = ReturnType<typeof parseLinkRow>

/** Everything the review page renders for one submission. */
export interface SubmissionDetailView {
	breakdown: HoursBreakdown
	claimLive: boolean
	coverImageUrl: string | null
	links: ReviewLink[]
	priorReviews: PriorReview[]
	sessions: ReviewSession[]
	submission: SubmissionDetail
	themeLabel: string
}

export async function getSubmissionDetail(
	submissionId: string,
	reviewerId?: string,
	flags?: { includeContact?: boolean; includeRiskFlags?: boolean },
): Promise<SubmissionDetailView | null> {
	const includeContact = flags?.includeContact ?? false
	const includeRiskFlags = flags?.includeRiskFlags ?? false
	const row = await loadSubmissionDetail(submissionId)
	if (!row) return null
	const project = row.themeProject
	if (!project) return null
	// Your own work is not reviewable by you, so it is not visible here either. Null rather than a 403: the review surface should not confirm that this is a submission you merely lack rights over.
	if (reviewerId && project.userId === reviewerId) return null
	const maker = project.user
	if (!maker) return null

	// Maker contact + risk flags only for ADMIN/AUDITOR (contact) and REVIEW_HOURS holders (risk flags) – the volume reviewer role gets the work, not the person (M6). Redacted here, before any caller can render or serialize them.
	if (!includeContact) {
		maker.email = ""
		maker.slackId = null
	}
	if (!includeRiskFlags) {
		maker.verificationStatus = null
		maker.fraudFlagged = false
	}

	const [breakdown, sessions, links, priorReviews] = await Promise.all([
		getHoursBreakdown(row.themeProjectId, row.phase, { live: false }),
		loadSessions(row.phase, row.themeProjectId),
		loadLinks(row.phase, row.themeProjectId),
		loadPriorReviews(row.themeProjectId),
	])
	const parsed = parseSubmissionRow(row)
	if (!parsed.themeProject?.user) return null
	const submission: SubmissionDetail = {
		...parsed,
		themeProject: { ...parsed.themeProject, user: parsed.themeProject.user },
	}

	return {
		breakdown,
		claimLive: submission.claim !== null && submission.claim.expiresAt.getTime() > Date.now(),
		coverImageUrl: publicUrlFor(project.coverImageKey),
		links: links.map(parseLinkRow),
		priorReviews: priorReviews.map(parsePriorReviewRow),
		sessions: sessions.map(parseSessionRow),
		submission,
		themeLabel: getThemeDef(project.theme).label,
	}
}

export interface OpenDispute {
	createdAt: Date
	id: string
	/** Replies so far, so the panel can say whether a reviewer has answered. */
	messageCount: number
	note: string
	participant: string
	phase: Phase
	projectTitle: string
	submissionId: string
	themeLabel: string
	themeProjectId: string
}

/**
 * Disputes no one has closed yet, oldest first.
 *
 * Surfaced on the program page so a maker asking for a second look is not left waiting on a queue nobody is watching.
 */
export async function getOpenDisputes(): Promise<OpenDispute[]> {
	const rows = await db.orm.public.ReviewDispute.where({ resolvedAt: null })
		.include("messages", messages => messages.count())
		.include("submission", submission =>
			submission
				.select("id", "phase")
				.include("themeProject", project =>
					project.select("id", "theme", "title").include("user", user => user.select("displayName", "email", "name")),
				),
		)
		.orderBy(dispute => dispute.createdAt.asc())
		.all()

	return rows.map(dispute => {
		const { submission } = dispute
		if (!submission) throw new Error(`dispute ${dispute.id} has no submission`)
		const { themeProject: project } = submission
		if (!project) throw new Error(`dispute ${dispute.id} has no project`)
		const { user } = project
		if (!user) throw new Error(`dispute ${dispute.id} has no author`)
		return {
			createdAt: parseDbTimestamp(dispute.createdAt),
			id: dispute.id,
			messageCount: dispute.messages,
			note: dispute.note,
			participant: displayName(user, user.email),
			phase: submission.phase,
			projectTitle: projectDisplayTitle(project),
			submissionId: submission.id,
			themeLabel: getThemeDef(project.theme).label,
			themeProjectId: project.id,
		}
	})
}
