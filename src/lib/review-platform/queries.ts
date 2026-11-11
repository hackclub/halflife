import "server-only"
import { and } from "@prisma/orm-postgres/orm-client"
import { listBom } from "@/lib/bom"
import { projectDisplayTitle, themeLabel } from "@/lib/config/program"
import { TIERS } from "@/lib/config/tiers"
import { displayName } from "@/lib/display-name"
import { HoursSource, Phase, PhaseStatus, ReviewResult } from "@/lib/enums"
import { getHoursBreakdown } from "@/lib/hours"
import { lapseTimelapseUrl } from "@/lib/lapse"
import { statusFor } from "@/lib/phase"
import db from "@/lib/prisma8"
import { renderReviewMarkdown } from "@/lib/review-platform/markdown"
import { githubRepoFrom } from "@/lib/review-platform/repo"
import type {
	ReviewDetail,
	ReviewDispute,
	ReviewEntry,
	ReviewHistoryItem,
	ReviewQueue,
	ReviewRow,
	ReviewStatus,
	ReviewViewer,
} from "@/lib/review-platform/types"
import { DAY_MS, formatDbTimestamp, parseDbTimestamp } from "@/lib/time"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * The read side of the review platform – the queue and the review screen, in the shape the Fabricate review UI expects.
 *
 * Nothing here writes. Every decision, claim and hours change goes through the routes the console already uses (`/api/review/*`, `/api/admin/*`), so the platform cannot drift from the rules those enforce: nobody reviews their own work, a reviewer cannot raise a tier past the request, and so on.
 */

const PAGE_SIZE = 50

const STATUSES: readonly ReviewStatus[] = Object.freeze(["pending", "approved", "returned", "rejected"])

const RESULT_FOR: { [_ in Exclude<ReviewStatus, "pending">]: ReviewResult } = Object.freeze({
	approved: ReviewResult.APPROVED,
	rejected: ReviewResult.REJECTED,
	returned: ReviewResult.RETURNED,
})

export const isReviewStatus = (value: string | undefined): value is ReviewStatus =>
	STATUSES.some(status => status === value)

/** A submission's state in the platform's four words. */
function statusOf(resolvedResult: ReviewResult | null): ReviewStatus {
	if (resolvedResult === ReviewResult.APPROVED) return "approved"
	if (resolvedResult === ReviewResult.RETURNED) return "returned"
	if (resolvedResult === ReviewResult.REJECTED) return "rejected"
	return "pending"
}

const ageDays = (submittedAt: Date, until: Date): number =>
	Math.max(0, Math.floor((until.getTime() - submittedAt.getTime()) / DAY_MS))

const shortDate = (date: Date): string =>
	date.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" })

const roundHours = (hours: number): number => Math.round(hours * 10) / 10

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Who made a decision, as a name the viewer may see.
 *
 * Ari decisions carry no Half Life user and store the Ari reviewer's address as their name – often a personal one. A reviewer gets the work, not the person, so an address is shown only to the roles that see contact details, and reads as Ari for everyone else.
 */
function deciderName(
	review: {
		reviewer: { displayName: string | null; name: string | null } | null
		reviewerId: string | null
		reviewerName: string | null
	},
	viewer: ReviewViewer,
): string {
	const named = displayName(review.reviewer)
	if (named) return named
	const stored = review.reviewerName?.trim()
	if (!stored) return review.reviewerId ? "–" : "Ari"
	if (EMAIL.test(stored)) return viewer.seesContact ? stored : review.reviewerId ? "A reviewer" : "Ari"
	return stored
}

/** Claimed journal hours per (project, phase), for a page of rows in one grouped query. */
async function claimedHoursFor(pairs: { phase: Phase; themeProjectId: string }[]): Promise<Map<string, number>> {
	const projectIds = [...new Set(pairs.map(pair => pair.themeProjectId))]
	if (projectIds.length === 0) return new Map()
	const rows = await db.orm.public.WorkSession.where({ deletedAt: null })
		.where(session => session.themeProjectId.in(projectIds))
		.groupBy("themeProjectId", "phase")
		.aggregate(group => ({ total: group.sum("hoursClaimed") }))
	return new Map(rows.map(row => [`${row.themeProjectId}:${row.phase}`, row.total ?? 0]))
}

/** The newest standing decision's reviewer for each resolved submission, by name. Ari decisions carry no Half Life user, so they read as Ari. */
async function deciderNames(submissionIds: string[], viewer: ReviewViewer): Promise<Map<string, string>> {
	if (submissionIds.length === 0) return new Map()
	const reviews = await db.orm.public.SubmissionReview.where({ invalidated: false })
		.where(review => review.submissionId.in(submissionIds))
		.select("submissionId", "reviewerName", "reviewerId", "createdAt")
		.include("reviewer", reviewer => reviewer.select("displayName", "name"))
		.orderBy(review => review.createdAt.asc())
		.all()
	const names = new Map<string, string>()
	for (const review of reviews) names.set(review.submissionId, deciderName(review, viewer))
	return names
}

interface RowSource {
	claim: { expiresAt: string; reviewer: { displayName: string | null; id: string; name: string | null } | null } | null
	createdAt: string
	id: string
	phase: Phase
	resolvedAt: string | null
	resolvedResult: ReviewResult | null
	themeProject: {
		id: string
		requestedTier: number | null
		theme: Parameters<typeof themeLabel>[0]
		tier: number | null
		title: string
		user: { displayName: string | null; fraudFlagged: boolean; id: string; name: string | null } | null
	} | null
}

async function toRows(
	rows: RowSource[],
	viewer: ReviewViewer,
	opts: { resubmissions?: Set<string> } = {},
): Promise<ReviewRow[]> {
	const now = new Date()
	const [hours, deciders] = await Promise.all([
		claimedHoursFor(
			rows.flatMap(row => (row.themeProject ? [{ phase: row.phase, themeProjectId: row.themeProject.id }] : [])),
		),
		deciderNames(
			rows.filter(row => row.resolvedAt).map(row => row.id),
			viewer,
		),
	])
	return rows.flatMap(row => {
		const project = row.themeProject
		const maker = project?.user
		if (!project || !maker) return []
		const submittedAt = parseDbTimestamp(row.createdAt)
		const status = statusOf(row.resolvedResult)
		const expiresAt = row.claim ? parseDbTimestamp(row.claim.expiresAt) : null
		const claimLive = status === "pending" && expiresAt !== null && expiresAt > now
		return [
			{
				ageDays: ageDays(submittedAt, now),
				claimExpiresAt: claimLive && expiresAt ? expiresAt.toISOString() : null,
				flagged: viewer.seesRiskFlags && maker.fraudFlagged,
				hoursClaimed: roundHours(hours.get(`${project.id}:${row.phase}`) ?? 0),
				id: row.id,
				kind: row.phase === Phase.DESIGN ? "design" : "build",
				makerId: maker.id,
				makerName: displayName(maker, "A maker"),
				projectId: project.id,
				projectName: projectDisplayTitle(project),
				requestedTier: project.requestedTier,
				resubmission: opts.resubmissions?.has(row.id) ?? false,
				reviewerName: claimLive ? displayName(row.claim?.reviewer, "A reviewer") : (deciders.get(row.id) ?? null),
				status,
				submittedAt: shortDate(submittedAt),
				themeLabel: themeLabel(project.theme),
				tier: status === "approved" && row.phase === Phase.DESIGN ? project.tier : null,
			} satisfies ReviewRow,
		]
	})
}

/** Which of these submissions follow an earlier hand-in of the same (project, phase). */
async function resubmissionsAmong(
	rows: { createdAt: string; id: string; phase: Phase; themeProjectId: string }[],
): Promise<Set<string>> {
	const projectIds = [...new Set(rows.map(row => row.themeProjectId))]
	if (projectIds.length === 0) return new Set()
	const all = await db.orm.public.PhaseSubmission.where(submission => submission.themeProjectId.in(projectIds))
		.select("createdAt", "id", "phase", "themeProjectId")
		.all()
	const earliest = new Map<string, string>()
	for (const submission of all) {
		const key = `${submission.themeProjectId}:${submission.phase}`
		const seen = earliest.get(key)
		if (!seen || submission.createdAt < seen) earliest.set(key, submission.createdAt)
	}
	return new Set(
		rows
			.filter(row => (earliest.get(`${row.themeProjectId}:${row.phase}`) ?? row.createdAt) < row.createdAt)
			.map(row => row.id),
	)
}

/** Submissions with the claim, project and maker a row needs, loaded in the same query. */
const submissionRows = () =>
	db.orm.public.PhaseSubmission.include("claim", claim =>
		claim.select("expiresAt").include("reviewer", reviewer => reviewer.select("displayName", "id", "name")),
	).include("themeProject", project =>
		project
			.select("id", "requestedTier", "theme", "tier", "title")
			.include("user", user => user.select("displayName", "fraudFlagged", "id", "name")),
	)

export async function getQueue(opts: {
	cursor?: string
	kind: "" | "design" | "build"
	mine: boolean
	status: ReviewStatus
	viewer: ReviewViewer
}): Promise<ReviewQueue> {
	const { viewer } = opts
	const live = formatDbTimestamp(new Date())
	const phase = opts.kind === "" ? null : opts.kind === "design" ? Phase.DESIGN : Phase.BUILD

	// One filter for the page and for every tab's count, so a count can never disagree with the list it labels.
	const scoped = (status: ReviewStatus) =>
		db.orm.public.PhaseSubmission.where(submission => {
			const conditions = [
				// Your own work is never yours to act on, so it is left out of every list here, decided ones included – the review screen refuses it anyway.
				submission.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.neq(viewer.id))),
				status === "pending" ? submission.resolvedAt.isNull() : submission.resolvedResult.eq(RESULT_FOR[status]),
			]
			if (phase) conditions.push(submission.phase.eq(phase))
			if (opts.mine)
				conditions.push(submission.claim.some(claim => and(claim.reviewerId.eq(viewer.id), claim.expiresAt.gt(live))))
			return and(...conditions)
		})

	const offset = Math.max(0, Math.trunc(Number(opts.cursor ?? "0")) || 0)
	const filtered = scoped(opts.status)
		.include("claim", claim =>
			claim.select("expiresAt").include("reviewer", reviewer => reviewer.select("displayName", "id", "name")),
		)
		.include("themeProject", project =>
			project
				.select("id", "requestedTier", "theme", "tier", "title")
				.include("user", user => user.select("displayName", "fraudFlagged", "id", "name")),
		)
	// Pending is oldest first, so whoever submitted first is seen first; a decided list is newest decision first, which is what someone checking a recent call is looking for.
	const ordered =
		opts.status === "pending"
			? filtered.orderBy([submission => submission.createdAt.asc(), submission => submission.id.asc()])
			: filtered.orderBy([submission => submission.resolvedAt.desc(), submission => submission.id.desc()])

	const [page, ...counts] = await Promise.all([
		ordered
			.select("createdAt", "id", "phase", "resolvedAt", "resolvedResult", "themeProjectId")
			.offset(offset)
			.limit(PAGE_SIZE + 1)
			.all(),
		...STATUSES.map(status => scoped(status).aggregate(a => ({ count: a.count() }))),
	])

	const rows = page.slice(0, PAGE_SIZE)
	const resubmissions = await resubmissionsAmong(rows)
	return {
		counts: Object.fromEntries(STATUSES.map((status, i) => [status, counts[i]?.count ?? 0])),
		next: page.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
		previous: offset > 0 ? String(Math.max(0, offset - PAGE_SIZE)) : null,
		rows: await toRows(rows, viewer, { resubmissions }),
	}
}

/** The oldest pending submission after this one that the viewer could pick up next. */
async function nextPending(viewer: ReviewViewer, after: { createdAt: string; id: string }): Promise<string | null> {
	const live = formatDbTimestamp(new Date())
	const next = await db.orm.public.PhaseSubmission.where({ resolvedAt: null })
		.where(submission =>
			and(
				submission.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.neq(viewer.id))),
				submission.id.neq(after.id),
				submission.createdAt.gte(after.createdAt),
			),
		)
		// Skips work someone else is already in the middle of.
		.where(submission => submission.claim.none(claim => and(claim.reviewerId.neq(viewer.id), claim.expiresAt.gt(live))))
		.select("id")
		.orderBy([submission => submission.createdAt.asc(), submission => submission.id.asc()])
		.first()
	return next?.id ?? null
}

/** The timelapse links a reviewer can open, from either provider. */
function timelapseLinks(
	timelapses: { externalId: string | null; objectKey: string | null; playbackUrl: string | null; provider: string }[],
): string[] {
	return timelapses.flatMap(t => {
		if (t.provider === "lapse" && t.externalId) return [lapseTimelapseUrl(t.externalId)]
		const url = t.playbackUrl ?? publicUrlFor(t.objectKey)
		return url ? [url] : []
	})
}

export async function getReviewDetail(submissionId: string, viewer: ReviewViewer): Promise<ReviewDetail | null> {
	const row = await db.orm.public.PhaseSubmission.whereUnique({ id: submissionId })
		.include("claim", claim => claim.include("reviewer", reviewer => reviewer.select("displayName", "id", "name")))
		.include("dispute", dispute =>
			dispute.include("messages", messages =>
				messages
					.include("author", author => author.select("displayName", "name"))
					.orderBy(message => message.createdAt.asc()),
			),
		)
		.include("reviews", reviews =>
			reviews
				.include("reviewer", reviewer => reviewer.select("displayName", "name"))
				.orderBy(review => review.createdAt.desc()),
		)
		.include("themeProject", project =>
			project.include("user", user =>
				user.select("displayName", "email", "fraudFlagged", "id", "name", "slackId", "verificationStatus"),
			),
		)
		.first()
	const project = row?.themeProject
	const maker = project?.user
	if (!row || !project || !maker || project.deletedAt) return null
	// Your own work is not reviewable by you, so it is not visible here either – the same null the console returns, which does not confirm that the submission exists.
	if (project.userId === viewer.id) return null

	const [breakdown, sessions, history, makerSubmissions, bom, next] = await Promise.all([
		getHoursBreakdown(row.themeProjectId, row.phase, { live: false }),
		db.orm.public.WorkSession.where({ deletedAt: null, phase: row.phase, themeProjectId: row.themeProjectId })
			.include("media", media => media.orderBy(m => m.sortOrder.asc()))
			.include("timelapses")
			.orderBy(session => session.createdAt.asc())
			.all(),
		db.orm.public.PhaseSubmission.where({ themeProjectId: row.themeProjectId })
			.where(submission => submission.id.neq(row.id))
			.include("reviews", reviews =>
				reviews
					.where({ invalidated: false })
					.include("reviewer", reviewer => reviewer.select("displayName", "name"))
					.orderBy(review => review.createdAt.desc()),
			)
			.orderBy(submission => submission.createdAt.desc())
			.all(),
		submissionRows()
			.where(submission =>
				submission.themeProject.some(other => and(other.userId.eq(maker.id), other.deletedAt.isNull())),
			)
			.select("createdAt", "id", "phase", "resolvedAt", "resolvedResult", "themeProjectId")
			.orderBy(submission => submission.createdAt.desc())
			.limit(30)
			.all(),
		listBom(row.themeProjectId),
		row.resolvedAt ? Promise.resolve(null) : nextPending(viewer, row),
	])

	const now = new Date()
	const submittedAt = parseDbTimestamp(row.createdAt)
	const status = statusOf(row.resolvedResult)
	const claimExpires = row.claim ? parseDbTimestamp(row.claim.expiresAt) : null
	const claimLive = status === "pending" && claimExpires !== null && claimExpires > now
	const standing = row.reviews.find(review => !review.invalidated) ?? null
	const phaseStatus = statusFor(project, row.phase)

	const entries: ReviewEntry[] = sessions.map(session => {
		const images = session.media.flatMap(m => {
			const url = publicUrlFor(m.objectKey)
			return url ? [url] : []
		})
		return {
			approvedSeconds: session.hoursApproved === null ? null : Math.round(session.hoursApproved * 3600),
			bodyHtml: renderReviewMarkdown(session.content ?? ""),
			// A Hackatime-tracked entry's time arrives through its link, so it counts for nothing here and is shown as evidence only.
			countsHours: session.hoursSource !== HoursSource.HACKATIME_TRACKED,
			date: session.effectiveDate ?? row.createdAt.slice(0, 10),
			id: session.id,
			imageUrls: images,
			reviewerNote: session.reviewComments,
			secondsSpent: Math.round(session.hoursClaimed * 3600),
			timelapseSeconds: session.timelapses.reduce((sum, t) => sum + (t.coveredSeconds ?? t.runtimeSeconds ?? 0), 0),
			timelapseUrls: timelapseLinks(session.timelapses),
			// Most entries' titles are the opening of their own body, which would print the same sentence twice; those read by date instead, as Fabricate's untitled entries do.
			title: (session.content ?? "").trimStart().startsWith(session.title.trim()) ? "" : session.title,
		}
	})

	const earlier: ReviewHistoryItem[] = history.map(submission => {
		const review = submission.reviews[0] ?? null
		return {
			feedback: review?.feedback ?? null,
			id: submission.id,
			kind: submission.phase === Phase.DESIGN ? "design" : "build",
			reason: viewer.seesRiskFlags ? (review?.reason ?? null) : null,
			reviewedAt: submission.resolvedAt ? shortDate(parseDbTimestamp(submission.resolvedAt)) : null,
			reviewerName: review ? deciderName(review, viewer) : null,
			status: statusOf(submission.resolvedResult),
			submittedAt: shortDate(parseDbTimestamp(submission.createdAt)),
			tier: review?.tierOverride ?? review?.frozenTier ?? null,
		}
	})

	const dispute: ReviewDispute | null = row.dispute
		? {
				createdAt: parseDbTimestamp(row.dispute.createdAt).toISOString(),
				id: row.dispute.id,
				messages: row.dispute.messages.map(message => ({
					at: parseDbTimestamp(message.createdAt).toISOString(),
					author: displayName(message.author, message.fromReviewer ? "A reviewer" : "The maker"),
					body: message.body,
					fromReviewer: message.fromReviewer,
					id: message.id,
				})),
				note: row.dispute.note,
				outcome: row.dispute.outcome,
				resolvedAt: row.dispute.resolvedAt ? parseDbTimestamp(row.dispute.resolvedAt).toISOString() : null,
			}
		: null

	const attachments = (row.attachmentKeys ?? []).flatMap(key => {
		const url = key ? publicUrlFor(key) : null
		return url ? [url] : []
	})
	const cover = publicUrlFor(project.coverImageKey)

	return {
		bom,
		bomTaxShippingUsd: project.bomTaxShippingUsd ?? 0,
		breakdown,
		dispute,
		entries,
		history: earlier,
		maker: {
			email: viewer.seesContact ? maker.email : null,
			fraudFlagged: viewer.seesRiskFlags ? maker.fraudFlagged : false,
			// Whether there is a Telescreen profile to link to – the Slack id itself stays on the server (see lib/review-platform/telescreen).
			hasTelescreen: maker.slackId !== null,
			id: maker.id,
			name: displayName(maker, "A maker"),
			slackId: viewer.seesContact ? maker.slackId : null,
			verificationStatus: viewer.seesRiskFlags ? maker.verificationStatus : null,
		},
		makerShips: (await toRows(makerSubmissions, viewer)).filter(other => other.id !== row.id),
		nextId: next,
		project: {
			description: project.description,
			githubRepo: githubRepoFrom(project.githubRepo),
			id: project.id,
			phaseStatus,
			repoLink: project.githubRepo,
			requestedTier: project.requestedTier,
			theme: themeLabel(project.theme),
			tier: project.tier,
			title: projectDisplayTitle(project),
		},
		ship: {
			ageDays: ageDays(submittedAt, now),
			claimExpiresAt: claimLive && claimExpires ? claimExpires.toISOString() : null,
			claimedByViewer: claimLive && row.claim?.reviewerId === viewer.id,
			claimerName: claimLive ? displayName(row.claim?.reviewer, "Another reviewer") : null,
			decision: standing
				? {
						feedback: standing.feedback,
						grantUsd: standing.grantUsdOverride ?? standing.frozenGrantUsd,
						hours: standing.hoursOverride ?? standing.frozenApprovedHours,
						reason: viewer.seesRiskFlags ? standing.reason : null,
						reviewedAt: shortDate(parseDbTimestamp(standing.createdAt)),
						reviewerName: deciderName(standing, viewer),
						technicalFeatures: standing.technicalFeatures,
						tier: standing.tierOverride ?? standing.frozenTier,
					}
				: null,
			fundingCapUsd: row.fundingCapUsd,
			fundingDeclined: row.fundingDeclined,
			id: row.id,
			imageUrls: [...(cover ? [cover] : []), ...attachments],
			kind: row.phase === Phase.DESIGN ? "design" : "build",
			notes: row.notes,
			onTime: row.onTime,
			partialFundingAccepted: row.partialFundingAccepted,
			requestedBomUsd: row.requestedBomUsd,
			resubmission: history.some(other => other.phase === row.phase && other.createdAt < row.createdAt),
			// The phase can be "approved" on the project while this row is a stale earlier hand-in, so decisions follow the project's own state, not just the row's.
			reviewable: status === "pending" && phaseStatus === PhaseStatus.in_review,
			status,
			submittedAt: shortDate(submittedAt),
			submittedInWeek: row.submittedInWeek,
		},
		tiers: TIERS.map(tier => ({ estimate: tier.estimate, grantUsd: tier.grantUsd, id: tier.id, name: tier.name })),
	}
}
