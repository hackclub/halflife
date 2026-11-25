/**
 * The shapes the review platform hands its client components.
 *
 * Plain JSON only – strings, numbers, booleans and ISO dates – because every one of these crosses the server/client boundary, and a field put here is a field any reviewer can read in their browser. Contact and risk fields are filled server-side only for the roles that may see them (`ReviewViewer`).
 */
import type { BomLine } from "@/lib/bom-schema"
import type { HoursBreakdown } from "@/lib/hours"
import type { JustificationContext } from "@/lib/review-platform/justification"

export type ReviewStatus = "pending" | "approved" | "returned" | "rejected"
export type ReviewKind = "design" | "build"

/** What the signed-in reviewer may see and do, decided once on the server from their roles. */
export interface ReviewViewer {
	/** OVERRIDE_DECISIONS: un-approve or reopen a decided phase. */
	canOverride: boolean
	/** REVIEW_HOURS: approve journal and Hackatime hours. */
	canReviewHours: boolean
	/** REVIEW_UNIFIED: check a website approval's Airtable row and send it to the unified database (T2). */
	canReviewUnified: boolean
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

/** A reviewer's note, or the project's standing flag, from "Flags & notes". Never shown to the maker. */
export interface ReviewNote {
	at: string
	author: string
	authorId: string
	body: string
	flag: boolean
	id: string
	/** What it is about: this ship, an earlier ship of the project (or one since unsubmitted), the project, or the maker on any project. A flag is always on the project. */
	subject: "ship" | "earlier-ship" | "project" | "maker"
}

export interface ReviewDecision {
	/** Why fewer hours were approved than claimed, when Ari's reviewer said. */
	deflationReason: string | null
	feedback: string
	grantUsd: number | null
	hours: number | null
	/** A website approval's justification as written to the row. Null for Ari's decisions, which go through the base's formula. */
	justification: string | null
	reason: string | null
	reviewedAt: string
	reviewerName: string
	technicalFeatures: string | null
	tier: number | null
	/** A website approval's T2 state: when it reached the unified database, or null while it waits. Null for Ari's decisions, which T2 does not see. */
	unified: { reviewId: string; sentAt: string | null } | null
}

export interface ReviewShip {
	ageDays: number
	/** The viewer's own approval, not yet sent on at T2 and not set by an hours override, so its entries can be re-deflated and re-paid (see `adjustApprovedHours`). */
	canAdjustHours: boolean
	/** The viewer's own decision, recent enough and still standing, so they can put the ship back into review (see `takeBackDecision`). */
	canTakeBack: boolean
	/** What the maker says changed since the review that returned this phase. Only a resubmission made since the field existed has it. */
	changesSinceLast: string | null
	claimExpiresAt: string | null
	claimedByViewer: boolean
	claimerName: string | null
	decision: ReviewDecision | null
	/** The maker's optional notes about the project, from the submit sheet. */
	extraNotes: string | null
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
	/** What the decision panel composes the approval's justification from. */
	justification: JustificationContext
	/** The ship the viewer last decided, when it is not this one. */
	lastDecisionId: string | null
	maker: ReviewMaker
	makerShips: ReviewRow[]
	nextId: string | null
	notes: ReviewNote[]
	project: ReviewProject
	ship: ReviewShip
	/** Telescreen's Robert fraud review and Spork copy check on this project (see lib/telescreen). */
	telescreen: ReviewTelescreen
	tiers: ReviewTier[]
}

/** Robert's fraud review of the project, as Fabricate's Robert card shows it. */
export interface ReviewRobert {
	/** Fields that point at two different people in Robert. */
	conflicts: string[]
	creditedHours: number | null
	error: string | null
	outcomeAt: string | null
	outcomeReason: string | null
	outcomeStatus: string | null
	reviewedAt: string | null
	reviewerName: string | null
	reviewFields: (readonly [string, string | number | boolean])[]
	reviewNote: string | null
	sentBy: string | null
	/** `awaiting_review`, `awaiting_outcome`, `rejected_fraud` or `decided`; null before Robert has it. */
	state: string | null
	submittedAt: string | null
	syncedAt: string | null
	trustScore: number | null
}

/** A repo Spork found a near-identical KiCad board (`pcb`) or STEP model (`cad`) in. */
export interface ReviewSporkMatch {
	/** How much of this design is in that repo, 0-1. */
	containment: number | null
	mode: string | null
	repo: string | null
	url: string | null
}

export interface ReviewSporkVerdict {
	at: string | null
	by: string | null
	verdict: "real" | "false_flag"
}

export interface ReviewTelescreen {
	/** Every repo Spork flagged, from its direct screen and Robert's, best match per repo first. */
	matches: ReviewSporkMatch[]
	robert: ReviewRobert | null
	robertConfigured: boolean
	/** Robert's Spork saw another person submit this exact repo. */
	robertSporkSameRepo: boolean
	/** The last direct Spork screen, null before one ran. */
	spork: { checkedAt: string | null; error: string | null } | null
	sporkConfigured: boolean
	/** A reviewer's call on the flag, while it still covers every flagged repo. */
	sporkVerdict: ReviewSporkVerdict | null
}

/** One editable column on the T2 screen. */
export interface UnifiedField {
	/** What Half Life writes on its own, which "reset" puts back. */
	generated: string
	/** A key of `YSWS_SUBMISSION.fields` (see `UNIFIED_EDITABLE`). */
	key: string
	/** The base's own column name. */
	label: string
	/** What the row will hold: the generated value, or the admin's override of it. */
	value: string
}

/** A website approval as T2 checks it before it goes to the unified database. */
export interface UnifiedReviewDetail {
	/** Why the row can't be written from here, or null when it can. */
	airtableProblem: string | null
	claimedHours: number
	/** For a build: when its design reached the unified database, "" when it hasn't. Null for a design. */
	designSentAt: string | null
	fields: UnifiedField[]
	generatedScreenshots: string[]
	/** The approval's id (`SubmissionReview.id`), which the T2 address is keyed by. */
	id: string
	kind: ReviewKind
	makerName: string
	maxScreenshots: number
	nextId: string | null
	/** Where this approval sits in the waiting queue, 1-based. Null once it has been sent. */
	position: number | null
	projectId: string
	projectName: string
	reviewedAt: string
	reviewerName: string
	screenshotOptions: string[]
	screenshots: string[]
	/** When it reached the unified database, and who sent it from T2 – null for one ticked by hand in the base. Null while it waits. */
	sent: { at: string; by: string | null } | null
	submissionId: string
	tier: number | null
	total: number
}
