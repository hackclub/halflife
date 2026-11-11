import "server-only"
import { and, or } from "@prisma/orm-postgres/orm-client"
import { listBom } from "@/lib/bom"
import { STARTER_PROJECTS } from "@/lib/config/onboarding"
import { projectDisplayTitle, scheduleForWeek, themeLabel, WARMUP_THEME } from "@/lib/config/program"
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
	ReviewFacets,
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
	if (EMAIL.test(stored)) return viewer.seesEmail ? stored : review.reviewerId ? "A reviewer" : "Ari"
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

/** A program week as the queue names it: the warm-up, or the theme and phase scheduled for it. */
export function weekLabel(week: number): string {
	if (week === 0) return WARMUP_THEME.label
	const schedule = scheduleForWeek(week)
	if (!schedule) return `Week ${week}`
	return `Week ${week} · ${themeLabel(schedule.theme.id)} ${schedule.phase === Phase.DESIGN ? "design" : "build"}`
}

/** The queue's narrowing filters, each null or "" for everything. */
export interface QueueFacets {
	/** "any" for every starter, "none" for the maker's own idea, or one starter's id. */
	starter: string
	/** The tier the row's badge shows: the approved tier once there is one, the requested tier before. */
	tier: number | null
	/** The program week the submission is scheduled for – its theme's week, not the week it was handed in. */
	week: number | null
}

export const isStarterFilter = (value: string | undefined): value is string =>
	value === "any" || value === "none" || STARTER_PROJECTS.some(starter => starter.id === value)

interface FacetRow {
	starter: string | null
	tier: number | null
	week: number | null
}

function starterMatches(filter: string, starter: string | null): boolean {
	if (filter === "") return true
	if (filter === "any") return starter !== null
	if (filter === "none") return starter === null
	return starter === filter
}

/** Whether a row passes every facet but `skip`, which is the one whose picker is being counted. */
const facetMatches = (row: FacetRow, facets: QueueFacets, skip: keyof QueueFacets): boolean =>
	(skip === "week" || facets.week === null || row.week === facets.week)
	&& (skip === "tier" || facets.tier === null || row.tier === facets.tier)
	&& (skip === "starter" || starterMatches(facets.starter, row.starter))

function countBy<K>(rows: FacetRow[], key: (row: FacetRow) => K | null): Map<K, number> {
	const counts = new Map<K, number>()
	for (const row of rows) {
		const value = key(row)
		if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1)
	}
	return counts
}

/**
 * The options each picker offers, counted over the current tab under every other filter, so an option's number is what choosing it would list.
 *
 * An option with nothing in it is left out unless it is the one chosen, which stays so the picker can still show it and switch back.
 */
function facetOptions(rows: FacetRow[], facets: QueueFacets): ReviewFacets {
	const weekCounts = countBy(
		rows.filter(row => facetMatches(row, facets, "week")),
		row => row.week,
	)
	const tierCounts = countBy(
		rows.filter(row => facetMatches(row, facets, "tier")),
		row => row.tier,
	)
	const starterRows = rows.filter(row => facetMatches(row, facets, "starter"))
	const starterCounts = countBy(starterRows, row => row.starter)
	const keep = (count: number, value: string, chosen: string): boolean => count > 0 || value === chosen
	const numbered = (counts: Map<number, number>, chosen: number | null, label: (value: number) => string) => {
		if (chosen !== null && !counts.has(chosen)) counts.set(chosen, 0)
		return [...counts]
			.toSorted(([a], [b]) => a - b)
			.map(([value, count]) => ({ count, label: label(value), value: String(value) }))
	}
	const ownIdea = starterRows.filter(row => row.starter === null).length
	return {
		starters: [
			{ count: starterRows.length - ownIdea, label: "any starter", value: "any" },
			...STARTER_PROJECTS.map(starter => ({
				count: starterCounts.get(starter.id) ?? 0,
				label: starter.title,
				value: starter.id,
			})),
			{ count: ownIdea, label: "own idea", value: "none" },
		].filter(option => keep(option.count, option.value, facets.starter)),
		tiers: numbered(tierCounts, facets.tier, tier => `Tier ${tier}`),
		weeks: numbered(weekCounts, facets.week, weekLabel),
	}
}

export async function getQueue(opts: {
	cursor?: string
	facets: QueueFacets
	kind: "" | "design" | "build"
	mine: boolean
	status: ReviewStatus
	viewer: ReviewViewer
}): Promise<ReviewQueue> {
	const { facets, viewer } = opts
	const live = formatDbTimestamp(new Date())
	const phase = opts.kind === "" ? null : opts.kind === "design" ? Phase.DESIGN : Phase.BUILD
	const everything: QueueFacets = { starter: "", tier: null, week: null }

	// One filter for the page and for every tab's count, so a count can never disagree with the list it labels.
	const scoped = (status: ReviewStatus, narrow: QueueFacets = facets) =>
		db.orm.public.PhaseSubmission.where(submission => {
			const conditions = [
				// Your own work is never yours to act on, so it is left out of every list here, decided ones included – the review screen refuses it anyway.
				submission.themeProject.some(project => {
					const projectConditions = [project.deletedAt.isNull(), project.userId.neq(viewer.id)]
					const { starter, tier } = narrow
					if (tier !== null)
						projectConditions.push(
							or(project.tier.eq(tier), and(project.tier.isNull(), project.requestedTier.eq(tier))),
						)
					if (starter === "any") projectConditions.push(project.starterProjectId.isNotNull())
					else if (starter === "none") projectConditions.push(project.starterProjectId.isNull())
					else if (starter) projectConditions.push(project.starterProjectId.eq(starter))
					return and(...projectConditions)
				}),
				status === "pending" ? submission.resolvedAt.isNull() : submission.resolvedResult.eq(RESULT_FOR[status]),
			]
			if (phase) conditions.push(submission.phase.eq(phase))
			if (narrow.week !== null) conditions.push(submission.scheduledWeek.eq(narrow.week))
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

	const [page, facetSource, ...counts] = await Promise.all([
		ordered
			.select("createdAt", "id", "phase", "resolvedAt", "resolvedResult", "themeProjectId")
			.offset(offset)
			.limit(PAGE_SIZE + 1)
			.all(),
		// The whole tab, three small columns a row: the pickers count it in memory rather than a query per option.
		scoped(opts.status, everything)
			.select("scheduledWeek")
			.include("themeProject", project => project.select("requestedTier", "starterProjectId", "tier"))
			.all(),
		...STATUSES.map(status => scoped(status).aggregate(a => ({ count: a.count() }))),
	])
	const facetRows: FacetRow[] = facetSource.map(row => ({
		starter: row.themeProject?.starterProjectId ?? null,
		tier: row.themeProject?.tier ?? row.themeProject?.requestedTier ?? null,
		week: row.scheduledWeek,
	}))

	const rows = page.slice(0, PAGE_SIZE)
	const resubmissions = await resubmissionsAmong(rows)
	return {
		counts: Object.fromEntries(STATUSES.map((status, i) => [status, counts[i]?.count ?? 0])),
		facets: facetOptions(facetRows, facets),
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
			email: viewer.seesEmail ? maker.email : null,
			fraudFlagged: viewer.seesRiskFlags ? maker.fraudFlagged : false,
			hasTelescreen: maker.slackId !== null,
			id: maker.id,
			name: displayName(maker, "A maker"),
			slackId: maker.slackId,
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
