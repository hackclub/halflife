/**
 * The shapes the review platform hands its client components.
 *
 * Plain JSON only – strings, numbers, booleans and ISO dates – because every one of these crosses the server/client boundary, and a field put here is a field any reviewer can read in their browser. Contact and risk fields are filled server-side only for the roles that may see them (`ReviewViewer`).
 */
import type { BomLine } from "@/lib/bom-schema"
import type { HoursBreakdown } from "@/lib/hours"

export type ReviewStatus = "pending" | "approved" | "returned" | "rejected"
export type ReviewKind = "design" | "build"

/** What the signed-in reviewer may see and do, decided once on the server from their roles. */
export interface ReviewViewer {
	/** OVERRIDE_DECISIONS: un-approve or reopen a decided phase. */
	canOverride: boolean
	/** REVIEW_HOURS: approve journal and Hackatime hours. */
	canReviewHours: boolean
	/** MANAGE_CREDIT: set a grant amount, or raise a tier past what the maker asked for. */
	canSetGrant: boolean
	displayName: string
	id: string
	isAdmin: boolean
	/** ADMIN or AUDITOR: the maker's email, and reviewers' emails where that is all a past review recorded. */
	seesEmail: boolean
	/** ADMIN, AUDITOR or REVIEW_HOURS: fraud flag, verification status and internal notes. */
	seesRiskFlags: boolean
}

export interface ReviewRow {
	ageDays: number
	claimExpiresAt: string | null
	flagged: boolean
	hoursClaimed: number
	id: string
	kind: ReviewKind
	makerId: string
	makerName: string
	projectId: string
	projectName: string
	requestedTier: number | null
	resubmission: boolean
	reviewerName: string | null
	status: ReviewStatus
	submittedAt: string
	themeLabel: string
	tier: number | null
}

/** One choice in a queue picker, with how many rows choosing it would list. */
export interface ReviewOption {
	count: number
	label: string
	value: string
}

export interface ReviewFacets {
	starters: ReviewOption[]
	tiers: ReviewOption[]
	weeks: ReviewOption[]
}

export interface ReviewQueue {
	counts: { [_: string]: number }
	/** The pickers' options, counted over the current tab. */
	facets: ReviewFacets
	next: string | null
	previous: string | null
	rows: ReviewRow[]
}

export interface ReviewEntry {
	approvedSeconds: number | null
	bodyHtml: string
	/** False for an entry whose time arrives through a Hackatime link: it is evidence, not hours. */
	countsHours: boolean
	date: string
	id: string
	imageUrls: string[]
	reviewerNote: string | null
	secondsSpent: number
	timelapseSeconds: number
	timelapseUrls: string[]
	title: string
}

export interface ReviewHistoryItem {
	feedback: string | null
	id: string
	kind: ReviewKind
	reason: string | null
	reviewedAt: string | null
	reviewerName: string | null
	status: ReviewStatus
	submittedAt: string
	tier: number | null
}

export interface ReviewDisputeMessage {
	at: string
	author: string
	body: string
	fromReviewer: boolean
	id: string
}

export interface ReviewDispute {
	createdAt: string
	id: string
	messages: ReviewDisputeMessage[]
	note: string
	outcome: string | null
	resolvedAt: string | null
}

export interface ReviewDecision {
	feedback: string
	grantUsd: number | null
	hours: number | null
	reason: string | null
	reviewedAt: string
	reviewerName: string
	technicalFeatures: string | null
	tier: number | null
}

export interface ReviewShip {
	ageDays: number
	claimExpiresAt: string | null
	claimedByViewer: boolean
	claimerName: string | null
	decision: ReviewDecision | null
	fundingCapUsd: number | null
	fundingDeclined: boolean
	id: string
	imageUrls: string[]
	kind: ReviewKind
	notes: string | null
	onTime: boolean
	partialFundingAccepted: boolean
	requestedBomUsd: number | null
	resubmission: boolean
	/** Pending here and in review on the project – the only state a decision can be made in. */
	reviewable: boolean
	status: ReviewStatus
	submittedAt: string
	submittedInWeek: number | null
}

export interface ReviewProject {
	description: string | null
	/** `owner/name` when the repository is on GitHub, which is what the file viewer can read. */
	githubRepo: string | null
	id: string
	phaseStatus: string
	repoLink: string | null
	requestedTier: number | null
	theme: string
	tier: number | null
	title: string
}

export interface ReviewMaker {
	email: string | null
	fraudFlagged: boolean
	/** Whether there is a Telescreen profile to link to, through `/api/reviews/[id]/telescreen`. */
	hasTelescreen: boolean
	id: string
	name: string
	slackId: string | null
	verificationStatus: string | null
}

export interface ReviewTier {
	estimate: string
	grantUsd: number
	id: number
	name: string
}

export interface ReviewDetail {
	bom: BomLine[]
	bomTaxShippingUsd: number
	breakdown: HoursBreakdown
	dispute: ReviewDispute | null
	entries: ReviewEntry[]
	history: ReviewHistoryItem[]
	maker: ReviewMaker
	makerShips: ReviewRow[]
	nextId: string | null
	project: ReviewProject
	ship: ReviewShip
	tiers: ReviewTier[]
}
