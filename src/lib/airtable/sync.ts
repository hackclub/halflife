import "server-only"
import { or } from "@prisma/orm-postgres/orm-client"
import {
	type AirtableConfig,
	type AirtableRecord,
	AirtableRecordSchema,
	airtableFetch,
	getAirtableConfig,
	withRateLimitRetry,
} from "@/lib/airtable/client"
import { deflationFor, deflationJustification, deflationReasonText, numberCell } from "@/lib/airtable/deflation"
import { existingColumns } from "@/lib/airtable/field-probe"
import {
	alternateTrackingJustification,
	justificationValues,
	reviewerTechnicalFeaturesCell,
	timelapseLinks,
} from "@/lib/airtable/justification"
import { fieldKey, LOOPS_REVIEW_OVERRIDE, toFields, YSWS_REVIEW_STATUS, YSWS_SUBMISSION } from "@/lib/airtable/schema"
import type { JustificationRow, JustificationRowMissing } from "@/lib/airtable/unified-justification"
import { deleteUnifiedRecords, deleteYswsRecord, updateYswsRecord, writeYswsRecord } from "@/lib/airtable/ysws"
import { bomTotalUsd } from "@/lib/bom-policy"
import { projectDisplayTitle, scheduledWeekFor } from "@/lib/config/program"
import { projectTierId } from "@/lib/config/tiers"
import { HoursSource, PayoutSource, Phase, PhaseStatus, ReviewResult } from "@/lib/enums"
import { syncHcaProfile } from "@/lib/hca-profile"
import { getHoursBreakdown } from "@/lib/hours"
import { lockKey } from "@/lib/locks"
import { round2 } from "@/lib/money"
import { statusFor } from "@/lib/phase"
import { decryptUserPII } from "@/lib/pii"
import db from "@/lib/prisma8"
import { getProgramSettings } from "@/lib/program"
import { findRepoFile } from "@/lib/repo-checks"
import { repoRefFromLink } from "@/lib/repo-ref"
import { parseDbTimestamp } from "@/lib/time"
import { isRecord } from "@/lib/unknown"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * One handed-in (themed project, phase) → one row in `YSWS Project Submission`, written at submit as "Pending Review".
 *
 * Half Life has no review page of its own: reviewers work on ari.hackclub.com, straight from this table. So the row is the submission, and everything a reviewer needs to judge it goes into it here – the repo, the hours, the timelapses, the parts money, the address to ship to.
 */

/**
 * The record id this (project, phase) was last written to, or null.
 *
 * Kept in the audit row each successful write leaves (see trackSideEffect), because the table has no column of ours to find the row by. A later "removed" entry means the row was deleted on unsubmit, so the next submission starts a fresh one.
 */
async function lastRecordId(themeProjectId: string, phase: Phase): Promise<string | null> {
	const rows = await db.orm.public.AuditLog.where({ action: "AIRTABLE_SYNC_SUCCESS", targetId: themeProjectId })
		.orderBy(entry => entry.createdAt.desc())
		.limit(50)
		.select("metadata")
		.all()
	for (const row of rows) {
		const meta = isRecord(row.metadata) ? row.metadata : null
		if (meta?.phase !== phase) continue
		if (meta.removed) return null
		if (typeof meta.recordId === "string") return meta.recordId
	}
	return null
}

/**
 * The newest record id each (project, phase) was written to, folded from audit rows a caller has already read.
 *
 * `lastRecordId` answers the same question for one submission at a time, which is what the live writers need. A backfill walks every project instead, where a lookup per phase is an N+1 read over thousands of rows, so it reads all the `AIRTABLE_SYNC_SUCCESS` rows once and folds them here. The rule is the same: rows arrive newest first, and a later `removed` beats an older record id, so a submission taken back on unsubmit reads as never written rather than at a row that no longer exists.
 */
export function recordIdsFromSyncEvents(events: { targetId: string | null; metadata: unknown }[]): Map<string, string> {
	const byPhase = new Map<string, string>()
	const settled = new Set<string>()
	for (const row of events) {
		const meta = isRecord(row.metadata) ? row.metadata : null
		if (!row.targetId || typeof meta?.phase !== "string") continue
		const key = `${row.targetId}:${meta.phase}`
		// Newest first, so the first row seen for a phase is the one that stands.
		if (settled.has(key)) continue
		settled.add(key)
		if (!meta.removed && typeof meta.recordId === "string") byPhase.set(key, meta.recordId)
	}
	return byPhase
}

/**
 * The Loops status for a phase in this state.
 *
 * A row is not only written at hand-in: a re-submission and an admin refresh write it again, and both used to stamp "Pending Review" unconditionally – which would put a decided row back to pending and have Loops tell the maker it was never reviewed. Reading the state means the column always says what the phase is, whichever write last touched it. `draft` never has a row at all, and reads as pending only so this is total.
 */
export function reviewStatusFor(status: PhaseStatus): string {
	if (status === PhaseStatus.approved) return YSWS_REVIEW_STATUS.approved
	if (status === PhaseStatus.rejected) return YSWS_REVIEW_STATUS.rejected
	if (status === PhaseStatus.update_requested) return YSWS_REVIEW_STATUS.changesRequested
	return YSWS_REVIEW_STATUS.pending
}

/**
 * The Loops status for a decision, read off the phase state it lands on rather than a second mapping: an approval moves the phase to `approved`, changes to `update_requested`, a rejection to `rejected` (see `finalizeReview`). One table, so a status can never disagree with the state it mirrors.
 */
export function reviewStatusForResult(result: ReviewResult): string {
	const after =
		result === ReviewResult.APPROVED
			? PhaseStatus.approved
			: result === ReviewResult.RETURNED
				? PhaseStatus.update_requested
				: PhaseStatus.rejected
	return reviewStatusFor(after)
}

/**
 * The `Loops - halfLifeProjectWeek` label for a scheduled week.
 *
 * A single select written with `typecast: false`, so the string has to already be an option in the base – and there is no option for a week that was never scheduled. The warm-up's week 0 therefore reads as null (left blank), not as a made-up label a write would then have to shed.
 */
export function projectWeekLabel(week: number): string | null {
	return week >= 1 && week <= 10 ? `Week ${week}` : null
}

/**
 * A zero-width stamp appended to an override value.
 *
 * The poller compares values to decide whether a field changed, and the dispatcher's override strategy then always sends whatever is in the envelope. A decision on the same project, or two decisions that name the same week, would otherwise write the same value the field already holds and be invisible to the poller. The stamp changes the source value without changing what the email renders.
 */
const ZERO_WIDTH = ["\u200B", "\u200C", "\u200D", "\u2060"]

function overrideStamp(value: string): string {
	let n = Date.now()
	let stamp = ""
	for (let i = 0; i < 8; i += 1) {
		stamp += ZERO_WIDTH[n % ZERO_WIDTH.length]
		n = Math.floor(n / ZERO_WIDTH.length)
	}
	return `${value}${stamp}`
}

/**
 * The two values a decision puts on its row's override columns.
 *
 * Exported so the field names and the week label can be checked without a database or an Airtable call: a typo in either name is the difference between email-tools recognising the field and ignoring it.
 */
export function reviewOverrideValues(title: string, week: number | null): { [_: string]: string } {
	return {
		[LOOPS_REVIEW_OVERRIDE.projectName]: overrideStamp(title),
		[LOOPS_REVIEW_OVERRIDE.projectWeek]: overrideStamp(projectWeekLabel(week ?? 0) ?? ""),
	}
}

/** The fields for this submission, exactly as the table names them. */
async function fieldsFor(themeProjectId: string, phase: Phase) {
	const project = await db.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
		.include("bomItems", items => items.select("name", "purpose", "quantity", "unitCostUsd"))
		.include("hackatimeLinks", links => links.where({ phase }).select("hackatimeProject"))
		.include("workSessions", sessions =>
			sessions
				.where({ deletedAt: null, phase })
				.orderBy(session => session.createdAt.asc())
				.select("content", "createdAt", "effectiveDate", "hoursClaimed", "hoursSource", "title")
				.include("timelapses", timelapse => timelapse.select("externalId", "objectKey", "playbackUrl", "provider")),
		)
		.first()
	if (!project) return null

	// Fresh from HCA, so the address a grant ships to is the one on file today rather than the one from whenever they last signed in.
	await syncHcaProfile(project.userId)
	const user = await db.orm.public.User.whereUnique({ id: project.userId }).firstOrThrow()
	const pii = decryptUserPII(user)

	const week = scheduledWeekFor(project.theme, phase)
	const settings = await getProgramSettings()

	const breakdown = await getHoursBreakdown(themeProjectId, phase)
	const bomTotal = bomTotalUsd(project.bomItems, project.bomTaxShippingUsd)

	// A design is judged from its repo; a build from the video of it working – the closing reel the submit sheet asks for, posted under this week's key.
	let playableUrl = project.githubRepo ?? ""
	if (phase === Phase.BUILD) {
		const demo = await db.orm.public.Post.where({
			checkpointKey: `w${week}-reel-submission`,
			deletedAt: null,
			userId: project.userId,
		})
			.orderBy(post => post.createdAt.desc())
			.select("objectKey")
			.first()
		playableUrl = publicUrlFor(demo?.objectKey ?? null) ?? playableUrl
	}

	const lapseLinks = timelapseLinks(project.workSessions.flatMap(s => s.timelapses))

	const [firstName, ...rest] = (user.name ?? "").trim().split(/\s+/)
	const tier = projectTierId(project)
	const journalUrl = await findRepoFile(project.githubRepo, /(^|\/)journal\.md$/i)
	const cover = publicUrlFor(project.coverImageKey)
	const phaseStatus = phase === Phase.DESIGN ? project.designStatus : project.buildStatus

	// The alternate method only exists when there is no tracked evidence to name. It is written at hand-in so the row is never handed to a reviewer without one. An approved row is left alone here: an admin refresh must not overwrite what a reviewer wrote.
	const hasTrackedEvidence = Boolean(user.hackatimeUserId) || project.hackatimeLinks.length > 0 || lapseLinks.length > 0
	const alternateTracking =
		phaseStatus !== PhaseStatus.in_review
			? undefined
			: hasTrackedEvidence
				? ""
				: alternateTrackingJustification({
						claimedHours: breakdown.journalHoursClaimed,
						entryCount: project.workSessions.filter(s => s.hoursSource !== HoursSource.HACKATIME_TRACKED).length,
					})

	const justification = justificationValues(
		{
			bomItems: project.bomItems,
			description: project.description,
			hackatimeProjects: project.hackatimeLinks.map(l => l.hackatimeProject),
			hackatimeUserId: user.hackatimeUserId,
			lapseLinks,
			workSessions: project.workSessions.map(session => ({
				...session,
				createdAt: parseDbTimestamp(session.createdAt),
			})),
		},
		{ eventStart: settings.eventStartDate, phase, theme: project.theme },
	)

	const fields = toFields(YSWS_SUBMISSION.fields, {
		// The reviewer's note belongs to the decision in front of the row. A new hand-in has none, so a re-submission clears the previous review's notes along with its status; an approved row is left alone, because an admin refresh must not erase what the reviewer wrote.
		additionalJustification: phaseStatus === PhaseStatus.in_review ? "" : undefined,
		codeUrl: project.githubRepo ?? "",
		email: user.email,
		firstName: firstName ?? "",
		lastName: rest.join(" "),
		...(pii.birthday ? { birthday: pii.birthday } : {}),
		addressLine1: pii.line1 ?? "",
		addressLine2: pii.line2 ?? "",
		alternateTracking,
		city: pii.city ?? "",
		country: pii.country ?? "",
		description: project.description ?? "",
		// A GitHub-only field: for a repo on another forge there is no GitHub username to send, and the repo URL is carried in its own column anyway.
		githubUsername: (() => {
			const ref = repoRefFromLink(project.githubRepo)
			return ref?.forge.id === "github" ? ref.ownerPath : ""
		})(),
		// The `Justification - …` columns, spread rather than listed: an evidence column we have nothing for is left out of the payload entirely, so a blank is never written over evidence the base already holds (see lib/airtable/justification). A row still in review carries the no-features marker there; an approved row keeps what the decision wrote, because a refresh must not erase the reviewer's box.
		...justification,
		halfLifeProjectId: themeProjectId,
		hoursSelfReported: round2(breakdown.journalHoursClaimed + breakdown.hackatimeHours),
		journalUrl: journalUrl ?? "",
		playableUrl,
		projectName: project.title,
		projectWeek: projectWeekLabel(week) ?? undefined,
		// The parts are funded once, at design. A build asks for no new money, so its row says $0 rather than repeating the design's request.
		// Under HCB the base is evidence rather than the payer: a zero here is what stops the YSWS pipeline paying a project Half Life has already funded by card grant.
		requestedFunding: phase === Phase.DESIGN && settings.payoutSource === PayoutSource.AIRTABLE ? bomTotal : 0,
		reviewStatus: reviewStatusFor(phaseStatus),
		slackId: user.slackId ?? "",
		specificTechnicalFeatures:
			phaseStatus === PhaseStatus.approved ? undefined : justification.specificTechnicalFeatures,
		stage: phase === Phase.DESIGN ? "Design" : "Build",
		// `starterProjectId` is the one place the choice is kept: set when a starter is taken and cleared when the idea is written over with their own (see lib/onboarding). So the checkbox is `!== null`, derived rather than stored, and a project that left the starter behind reads as `false` here like any other.
		starterProject: project.starterProjectId !== null,
		state: pii.state ?? "",
		tier: tier ? `Tier ${tier}` : "",
		zip: pii.zip ?? "",
	})
	// An attachment is written as a URL Airtable fetches, so the bytes stay in R2 and the base only references them.
	if (cover) fields[fieldKey(YSWS_SUBMISSION.fields.screenshot)] = [{ url: cover }]
	return fields
}

/**
 * Serialize the adopt-or-create decision for one (project, phase).
 *
 * The record id is only known from an audit row written after a successful write, so two callers can arrive before either row exists – the submit `after` hook and the hourly retry job, or an admin's Retry button racing either. Both read "no row yet", both find nothing to adopt, and both POST a new "Pending Review" row into the payout sink. Postgres serializes them here: the loser runs its lookup after the winner's row exists and adopts it instead of creating a second.
 *
 * An advisory xact lock releases with the transaction. The work inside is HTTP, so the transaction gets a generous timeout rather than the default 5 seconds, which would release the lock in the middle of Airtable's own retry backoff.
 */
function withYswsWriteLock<T>(themeProjectId: string, phase: Phase, fn: () => Promise<T>): Promise<T> {
	// P8 transactions take no timeout options; the lock releases with the transaction either way.
	return db.transaction(async tx => {
		await lockKey(tx, `ysws:${themeProjectId}:${phase}`)
		return fn()
	})
}

/**
 * Write this submission's row: a new one the first time, the same one on a re-submission, so a phase handed in twice is never two rows. The lookup and the write are one critical section, because a create that loses its response and a concurrent create are indistinguishable without it.
 */
export async function syncSubmissionToYsws(
	themeProjectId: string,
	phase: Phase,
): Promise<{ recordId: string; dropped: string[] } | { skipped: string }> {
	const settings = await getProgramSettings()
	if (!settings.airtableSyncEnabled) return { skipped: "sync_disabled" }
	const fields = await fieldsFor(themeProjectId, phase)
	if (!fields) return { skipped: "project_not_found" }
	return withYswsWriteLock(themeProjectId, phase, async () =>
		writeYswsRecord(fields, await lastRecordId(themeProjectId, phase), { themeProjectId }),
	)
}

/** The cells the decision mirror needs from a submission's row. */
interface ReviewRowValues {
	hackatimeId: string
	hackatimeProjects: string
	lapseLinks: string
	overrideJustification: string
	selfReportedHours: number | null
}

/** A text cell, trimmed: Airtable omits an empty one entirely and may hand a formula back as text. */
const textCell = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

/**
 * The row cells a decision needs, read once so deflation and alternate tracking share a request.
 *
 * The whole row is read, not a field list: `fields[]` exists on list-records only, and Airtable refuses a get-record that names it with a 422 rather than ignoring the parameter.
 *
 * A read that fails returns null rather than throwing. Nothing here can then say whether a row was deflated or what its tracking columns hold, so the status and note are still written and the extra columns are left as they were.
 */
async function readReviewRow(config: AirtableConfig, recordId: string): Promise<ReviewRowValues | null> {
	const { hackatimeId, hackatimeProjects, hoursSelfReported, lapseLinks, overrideHoursSpentJustification } =
		YSWS_SUBMISSION.fields
	let row: AirtableRecord
	try {
		row = await withRateLimitRetry("readYswsReviewRow", () =>
			airtableFetch(
				AirtableRecordSchema,
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}/${encodeURIComponent(recordId)}`,
			),
		)
	} catch (err) {
		console.error(
			`[airtable] could not read YSWS row ${recordId}; leaving the deflation, alternate-tracking and specific-features columns alone:`,
			err,
		)
		return null
	}
	const cell = (field: { id: string; name: string }) => row.fields[fieldKey(field)]
	return {
		hackatimeId: textCell(cell(hackatimeId)),
		hackatimeProjects: textCell(cell(hackatimeProjects)),
		lapseLinks: textCell(cell(lapseLinks)),
		overrideJustification: textCell(cell(overrideHoursSpentJustification)),
		selfReportedHours: numberCell(cell(hoursSelfReported)),
	}
}

/**
 * The hours-override and deflation-justification columns for a decision.
 *
 * The payout pipeline reads `Optional - Override Hours Spent` for approved rows, so it must never be blank: when a review cut the claimed total, it holds the approved hours; otherwise it holds the claimed (self-reported) hours from the row. The claimed figure comes from the row rather than being recomputed here, because it is the number the base already shows and recomputing it from local hours would drift from the base whenever Hackatime's cache or an entry approval has moved since hand-in.
 *
 * `Justification - Deflation Justification` is only written when hours were cut. `reason` is the reviewer's justification for the cut – Ari's own deflation reason when it carried one, else the review's internal note – and never the note to the maker, which has its own column and is quoted in the email.
 *
 * An approved row whose frozen hours are missing is left alone: nothing here can say what figure to put. A non-approved row is cleared, because an override that outlived its approval would keep paying hours nobody is standing behind.
 */
function deflationColumns(
	project: { approvedHours: number | null; designApprovedHours: number | null },
	phase: Phase,
	status: string,
	reason: string | null,
	row: ReviewRowValues | null,
): { [_: string]: unknown } {
	const { deflationJustification: justificationField, overrideHoursSpent } = YSWS_SUBMISSION.fields
	const overrideKey = fieldKey(overrideHoursSpent)
	const justificationKey = fieldKey(justificationField)
	const clear = { [overrideKey]: null, [justificationKey]: "" }
	if (status !== YSWS_REVIEW_STATUS.approved) return clear
	// The row could not be read, so nothing here can say what figure to write.
	if (!row) return {}

	const approved = phase === Phase.DESIGN ? project.designApprovedHours : project.approvedHours
	if (approved === null) return {}

	const deflation = deflationFor(approved, row.selfReportedHours)
	if (deflation)
		return {
			[overrideKey]: deflation.approvedHours,
			[justificationKey]: deflationJustification(deflation, reason),
		}
	const claimed = row.selfReportedHours ?? round2(approved)
	return { [overrideKey]: claimed, [justificationKey]: "" }
}

/**
 * The `Justification - Alternate Tracking Method` text an approval writes: empty when the row has Hackatime or Lapse evidence, else the devlog entries the hours rest on.
 *
 * Only an approval writes it: it is the justification of hours that were paid, and an earlier review's method should not be erased by a return, a reopen or a reset that has nothing new to say. When the row has since gained Hackatime or Lapse evidence the column is cleared, because the alternate method it described is no longer the one the hours rest on. The reviewer's reasoning is not put here: it says what the work is, not how the hours were tracked, and belongs in the specific-features and additional-justification columns instead.
 */
async function approvalAlternateTracking(themeProjectId: string, phase: Phase, row: ReviewRowValues): Promise<string> {
	if ([row.hackatimeId, row.hackatimeProjects, row.lapseLinks].some(value => value !== "")) return ""
	const sessions = await db.orm.public.WorkSession.where({ deletedAt: null, phase, themeProjectId })
		.select("hoursClaimed", "hoursSource")
		.all()
	const manual = sessions.filter(s => s.hoursSource !== HoursSource.HACKATIME_TRACKED)
	return alternateTrackingJustification({
		claimedHours: row.selfReportedHours ?? round2(manual.reduce((sum, s) => sum + s.hoursClaimed, 0)),
		entryCount: manual.length,
	})
}

/**
 * The submission's row as an approval would find it, for the review screen's preview of `Automation - Unified Justification`.
 *
 * Read from the base when it can be, because that is what the decision reads too: the claimed hours a deflation is measured against, and the evidence columns, which for the pre-season imports exist nowhere else. When it cannot – sync off, no key (as in local development), no row yet, or a failed read – the row is rebuilt from Postgres the way hand-in writes it, and `missing` says why, so the preview can say an approval will not write it.
 */
export async function readJustificationRow(
	themeProjectId: string,
	phase: Phase,
): Promise<{ missing: JustificationRowMissing | null; row: JustificationRow }> {
	const read = await (async (): Promise<JustificationRowMissing | ReviewRowValues> => {
		const settings = await getProgramSettings()
		if (!settings.airtableSyncEnabled) return "sync_disabled"
		const config = getAirtableConfig()
		if (!config) return "not_configured"
		const recordId = await lastRecordId(themeProjectId, phase)
		if (!recordId) return "no_row"
		return (await readReviewRow(config, recordId)) ?? "unreadable"
	})()
	const row = typeof read === "string" ? await localReviewRow(themeProjectId, phase) : read
	return {
		missing: typeof read === "string" ? read : null,
		row: {
			alternateTracking: await approvalAlternateTracking(themeProjectId, phase, row),
			claimedHours: row.selfReportedHours,
			hackatimeId: row.hackatimeId,
			hackatimeProjects: row.hackatimeProjects,
			lapseLinks: row.lapseLinks,
			overrideJustification: row.overrideJustification,
		},
	}
}

/**
 * The row's evidence columns and claimed hours as hand-in writes them (see `fieldsFor`), from Postgres alone. The override justification is the program team's, written only in the base, so it is empty here.
 */
async function localReviewRow(themeProjectId: string, phase: Phase): Promise<ReviewRowValues> {
	const [project, settings, breakdown] = await Promise.all([
		db.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
			.select("theme")
			.include("user", user => user.select("hackatimeUserId"))
			.include("hackatimeLinks", links => links.where({ phase }).select("hackatimeProject"))
			.include("workSessions", sessions =>
				sessions
					.where({ deletedAt: null, phase })
					.select("id")
					.include("timelapses", timelapse => timelapse.select("externalId", "objectKey", "playbackUrl", "provider")),
			)
			.firstOrThrow(),
		getProgramSettings(),
		getHoursBreakdown(themeProjectId, phase),
	])
	const values = justificationValues(
		{
			bomItems: [],
			description: null,
			hackatimeProjects: project.hackatimeLinks.map(link => link.hackatimeProject),
			hackatimeUserId: project.user?.hackatimeUserId ?? null,
			lapseLinks: timelapseLinks(project.workSessions.flatMap(session => session.timelapses)),
			workSessions: [],
		},
		{ eventStart: settings.eventStartDate, phase, theme: project.theme },
	)
	return {
		hackatimeId: values.hackatimeId ?? "",
		hackatimeProjects: values.hackatimeProjects ?? "",
		lapseLinks: values.lapseLinks ?? "",
		overrideJustification: "",
		selfReportedHours: round2(breakdown.journalHoursClaimed + breakdown.hackatimeHours),
	}
}

/**
 * Move a submission's row on to the decision Ari just reached: the status Loops triggers on, the reviewer's note the email quotes, and the project and week that decision is about.
 *
 * The email-tools poller only forwards a `Loops - …` field when the value on that row changed. The row's `Loops - halfLifeProjectName` and `Loops - halfLifeProjectWeek` are written at submit and never change on a decision, so the poller never re-sends them; the contact keeps whatever was submitted most recently. The `Loops - Override - …` columns are separate fields, so writing them here is a change the poller forwards, and email-tools maps them onto the same contact property with its override strategy. The status trigger and the project it names then arrive in one contact update.
 *
 * Half Life writes the row as "Pending Review" and reviewers work from ari.hackclub.com, but a decision there changes nothing in the base – without this the status sits at "Pending Review" forever and the note is never written (see YSWS_REVIEW_STATUS in lib/airtable/schema).
 *
 * Best-effort, and only ever after the fact: the review is already committed in Postgres by the time this runs, so a base that is briefly unreachable must not throw and turn a decided submission into one Ari redelivers. No row is not a failure either – a submission written before this sync existed has no record id, and one taken back has none any more.
 *
 * The status, note, first-pass reviewer, overrides, deflation, alternate-tracking and specific-features values are written together in the ordinary case. If that request is refused, the fallback keeps the status load-bearing: status + overrides + hours, then status alone, then the note and the reviewer. Each failure is named.
 *
 * `reviewerEmail` is Ari's `review.reviewer.email`, the reviewer who made the decision (the first of Ari's two passes). Omitting it leaves the column alone; passing null clears it for a decision that no longer stands.
 *
 * `deflationReason` is Ari's `review.justification.deflation_reason`: the reviewer's own account of why they approved fewer hours than the row claims. It is preferred for `Justification - Deflation Justification`; without it that column falls back to the review's internal reason. The maker-facing note is never used there – it is written to `Loops - halfLifeReviewerNotes` and emailed, and it says nothing about the cut.
 *
 * The review's internal reason is also written to `Justification - Additional Justification`, which is where the pipeline reads Ari's "Justification notes" (`review.audit_note`) from. `justificationNotes` is that note; undefined leaves the column alone (an older caller), null clears it for a decision that no longer stands.
 *
 * The reviewer's technical features come from the standing review (`SubmissionReview.technicalFeatures`, Ari's `review.justification.technical_features`). `Justification - Specific Technical Features` carries those words and nothing else – a decision overwrites whatever an earlier account or journal text put there, and a decision made without them writes an empty cell. A refresh never re-adds the maker's account.
 */
export async function syncReviewDecisionToYsws(
	themeProjectId: string,
	phase: Phase,
	status: string,
	note: string | null,
	reviewerEmail?: string | null,
	deflationReason?: string | null,
	justificationNotes?: string | null,
): Promise<{ updated: boolean; reason?: string; noteFailed?: string; reviewerFailed?: string }> {
	const settings = await getProgramSettings()
	if (!settings.airtableSyncEnabled) return { reason: "sync_disabled", updated: false }
	// The id lives in the audit row each successful write left (see lastRecordId), not in a column of ours.
	const recordId = await lastRecordId(themeProjectId, phase)
	if (!recordId) return { reason: "no_row", updated: false }

	const {
		additionalJustification,
		alternateTracking: alternateTrackingField,
		deflationJustification: deflationField,
		overrideHoursSpent,
		pass1Reviewer,
		reviewStatus,
		reviewerNotes,
		specificTechnicalFeatures: specificFeaturesField,
	} = YSWS_SUBMISSION.fields
	const statusField = { [fieldKey(reviewStatus)]: status }
	const noteField = { [fieldKey(reviewerNotes)]: note ?? "" }
	// Undefined leaves the column alone, for a caller that only knows about the status (the older review backfill). Null clears it, for a decision that no longer stands.
	const reviewerField = reviewerEmail === undefined ? null : { [fieldKey(pass1Reviewer)]: reviewerEmail ?? "" }

	// The override, reviewer and justification columns may not exist yet on a base that predates them. Airtable rejects a whole PATCH for one unknown field, so ask first and leave them out when absent rather than losing the status with them.
	const overrides: { [_: string]: unknown } = {}
	const deflationFields: { [_: string]: unknown } = {}
	const alternateFields: { [_: string]: unknown } = {}
	const additionalFields: { [_: string]: unknown } = {}
	const specificFields: { [_: string]: unknown } = {}
	let reviewerWritable = false
	const config = getAirtableConfig()
	if (config) {
		let writable = new Set<string>()
		try {
			writable = await existingColumns(config, YSWS_SUBMISSION.tableId, [
				...Object.values(LOOPS_REVIEW_OVERRIDE),
				pass1Reviewer.name,
				overrideHoursSpent.name,
				deflationField.name,
				alternateTrackingField.name,
				additionalJustification.name,
				specificFeaturesField.name,
			])
		} catch (err) {
			// A probe failure is not a reason to lose the status; the next decision retries it.
			console.error(
				`[airtable] could not check whether the Loops override, reviewer and justification columns exist; writing the decision for ${themeProjectId} (${phase}) without them:`,
				err,
			)
		}
		reviewerWritable = writable.has(pass1Reviewer.name)
		const hasDeflationColumns = writable.has(overrideHoursSpent.name) && writable.has(deflationField.name)
		const hasAlternateColumn = writable.has(alternateTrackingField.name)
		const hasSpecificColumn = writable.has(specificFeaturesField.name)
		// The reviewer's "Justification notes", written verbatim. Undefined is a caller that does not know the column; null or blank clears it, so a reversal or a decision with no note cannot leave the previous review's words on the row.
		if (writable.has(additionalJustification.name) && justificationNotes !== undefined)
			additionalFields[fieldKey(additionalJustification)] = justificationNotes?.trim() ?? ""
		if (writable.size > 0)
			try {
				const [project, submission] = await Promise.all([
					db.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
						.select("approvedHours", "designApprovedHours", "theme", "title")
						.first(),
					db.orm.public.PhaseSubmission.where({ phase, themeProjectId })
						.orderBy(row => row.createdAt.desc())
						.select("scheduledWeek")
						.include("reviews", reviews =>
							reviews
								.where({ invalidated: false })
								.orderBy(review => review.createdAt.desc())
								.select("reason", "technicalFeatures"),
						)
						.first(),
				])
				if (project) {
					const week = submission?.scheduledWeek ?? scheduledWeekFor(project.theme, phase)
					const values = reviewOverrideValues(projectDisplayTitle(project), week)
					for (const [field, value] of Object.entries(values)) if (writable.has(field)) overrides[field] = value

					const row =
						hasSpecificColumn || (status === YSWS_REVIEW_STATUS.approved && (hasDeflationColumns || hasAlternateColumn))
							? await readReviewRow(config, recordId)
							: null
					// The review's internal note, which is the reviewer's own reasoning rather than the words they sent the maker. It is Ari's `audit_note` – the "Justification notes" field – and the fallback for the deflation column.
					const reviewReason = submission?.reviews[0]?.reason?.trim() || null
					// Ari's `review.justification.technical_features`: what the reviewer said the project has that accounts for the hours. The section is replaced wholesale, not composed.
					const reviewerFeatures = submission?.reviews[0]?.technicalFeatures?.trim() || null
					// Ari's dedicated deflation reason when the decision carried one; never the maker's note, which is quoted in the email and says nothing about why hours came down.
					const justificationReason = deflationReasonText(deflationReason, reviewReason)
					if (hasDeflationColumns)
						Object.assign(deflationFields, deflationColumns(project, phase, status, justificationReason, row))
					if (hasSpecificColumn)
						specificFields[fieldKey(specificFeaturesField)] = reviewerTechnicalFeaturesCell(reviewerFeatures)
					if (hasAlternateColumn && row && status === YSWS_REVIEW_STATUS.approved)
						alternateFields[fieldKey(alternateTrackingField)] = await approvalAlternateTracking(
							themeProjectId,
							phase,
							row,
						)
				}
			} catch (err) {
				// The status still lands; this names the extra values that did not.
				console.error(
					`[airtable] could not build the Loops override and justification values for ${themeProjectId} (${phase}); writing the decision without them:`,
					err,
				)
			}
	}

	const complete = {
		...statusField,
		...noteField,
		...(reviewerWritable && reviewerField ? reviewerField : {}),
		...overrides,
		...deflationFields,
		...alternateFields,
		...additionalFields,
		...specificFields,
	}
	const moved = await updateYswsRecord(recordId, complete)
	if (moved.ok) return { updated: true }

	// The complete write was refused. Keep the status load-bearing, and keep the overrides, hours and justification columns with it so the email can still name the project and the payout still sees the cut.
	const core = await updateYswsRecord(recordId, {
		...statusField,
		...overrides,
		...deflationFields,
		...alternateFields,
		...additionalFields,
		...specificFields,
	})
	if (!core.ok) {
		const statusOnly = await updateYswsRecord(recordId, statusField)
		if (!statusOnly.ok) return { reason: statusOnly.reason, updated: false }
	}
	const noted = await updateYswsRecord(recordId, noteField)
	const reviewed = reviewerWritable && reviewerField ? await updateYswsRecord(recordId, reviewerField) : null
	return {
		updated: true,
		...(noted.ok ? {} : { noteFailed: noted.reason }),
		...(reviewed && !reviewed.ok ? { reviewerFailed: reviewed.reason } : {}),
	}
}

/**
 * Put a decision on the submission's Airtable row, for Loops, and log whatever did not land.
 *
 * Every decision path calls this once its own change has committed – the Ari webhook, the review console, and an admin's un-approve or reopen – so the row cannot be moved by one path and left behind by another. `status` is the state the phase is now in, `note` is the reviewer's own words, and `reviewerEmail` is who made the decision, each null to clear its column. `deflationReason` is Ari's dedicated justification for a cut, which is preferred over the review's internal note in the deflation column. `justificationNotes` is Ari's "Justification notes" (`review.audit_note`), written to `Justification - Additional Justification`; omit it to leave that column alone, or pass null to clear it.
 *
 * Never throws: the review is already committed when this runs, so a failure is logged rather than raised. On the Ari path that is load-bearing – a throw becomes a 5xx and a redelivery of a decision that has already been applied.
 */
export async function mirrorReviewDecision(
	themeProjectId: string,
	phase: Phase,
	status: string,
	note: string | null,
	reviewerEmail?: string | null,
	deflationReason?: string | null,
	justificationNotes?: string | null,
): Promise<void> {
	const mirrored = await syncReviewDecisionToYsws(
		themeProjectId,
		phase,
		status,
		note,
		reviewerEmail,
		deflationReason,
		justificationNotes,
	)
	// Not failures: no row was ever written (or it was taken back), and a switched-off sync means the base is deliberately not the one to update.
	if (!mirrored.updated && mirrored.reason !== "no_row" && mirrored.reason !== "sync_disabled")
		console.error(
			`[airtable] could not set the review status for ${themeProjectId} (${phase}) to "${status}": ${mirrored.reason}`,
		)
	else if (mirrored.noteFailed)
		console.error(
			`[airtable] moved the review status for ${themeProjectId} (${phase}) but could not write the reviewer's note: ${mirrored.noteFailed}`,
		)
	else if (mirrored.reviewerFailed)
		console.error(
			`[airtable] moved the review status for ${themeProjectId} (${phase}) but could not write the pass 1 reviewer: ${mirrored.reviewerFailed}`,
		)
}

/**
 * Ari's phase names as an operator reads them on the row.
 *
 * Unknown values fall through unchanged rather than being dropped: a phase Ari adds later should still show up in the base, even if this map has not learned a nicer word for it.
 */
const ARI_PHASE_LABEL: { [_: string]: string } = {
	fraud_review: "Fraud review",
	processing: "Processing",
	reverted: "Reverted",
	review: "In review",
	reviewed: "Reviewed",
	second_pass: "Second pass",
	under_review: "Under review",
	withdrawn: "Withdrawn",
}

/** Mirror a ship's current Ari phase onto its Airtable row, where an operator can see a hold or a return that Ari never pushes. */
export async function mirrorAriPhaseToYsws(
	themeProjectId: string,
	phase: Phase,
	ariPhase: string,
	at: Date,
): Promise<void> {
	try {
		const settings = await getProgramSettings()
		if (!settings.airtableSyncEnabled) return
		const config = getAirtableConfig()
		if (!config) return
		const recordId = await lastRecordId(themeProjectId, phase)
		if (!recordId) return

		const { ariReviewPhase, ariReviewPhaseAt, ariSecondPassSince } = YSWS_SUBMISSION.fields
		const { tableId } = YSWS_SUBMISSION
		const columns = [ariReviewPhase, ariReviewPhaseAt, ariSecondPassSince]
		const writable = await existingColumns(
			config,
			tableId,
			columns.map(column => column.name),
		)
		const values: { [_: string]: unknown } = {}
		if (writable.has(ariReviewPhase.name)) values[fieldKey(ariReviewPhase)] = ARI_PHASE_LABEL[ariPhase] ?? ariPhase
		if (writable.has(ariReviewPhaseAt.name)) values[fieldKey(ariReviewPhaseAt)] = at.toISOString()
		if (writable.has(ariSecondPassSince.name))
			values[fieldKey(ariSecondPassSince)] = ariPhase === "second_pass" ? at.toISOString() : null
		if (Object.keys(values).length === 0) return

		const written = await updateYswsRecord(recordId, values)
		if (!written.ok && written.reason !== "row_gone" && written.reason !== "not_configured")
			console.error(`[airtable] could not write the Ari phase for ${themeProjectId} (${phase}): ${written.reason}`)
	} catch (err) {
		// The poll must keep going for every other ship; the next run retries this one.
		console.error(`[airtable] could not mirror the Ari phase for ${themeProjectId} (${phase}):`, err)
	}
}

/** Remove a submission's row, and its unified-base twin, when it is taken back. */
export async function removeSubmissionFromYsws(
	themeProjectId: string,
	phase: Phase,
): Promise<{ deleted: boolean; unifiedDeleted: string[]; skipped?: string }> {
	const recordId = await lastRecordId(themeProjectId, phase)
	if (!recordId) return { deleted: false, skipped: "no_row", unifiedDeleted: [] }
	const local = await deleteYswsRecord(recordId)
	if (!local.unifiedRecordId) return { deleted: local.deleted, skipped: local.skipped, unifiedDeleted: [] }
	const unified = await deleteUnifiedRecords([local.unifiedRecordId])
	return { deleted: local.deleted, skipped: unified.skipped, unifiedDeleted: unified.deleted }
}

/**
 * Submissions awaiting review whose row never made it to the table – a write that failed, or one made before this sync existed. Replayed by the retry job and listed on /admin/program.
 */
export async function findUnsyncedSubmissions(): Promise<{ themeProjectId: string; phase: Phase }[]> {
	const pending = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.where(project => or(project.designStatus.eq(PhaseStatus.in_review), project.buildStatus.eq(PhaseStatus.in_review)))
		.select("buildStatus", "designStatus", "id")
		.include("submissions", submissions =>
			submissions.orderBy(submission => submission.createdAt.desc()).select("createdAt", "phase"),
		)
		.all()
	if (pending.length === 0) return []

	const synced = await db.orm.public.AuditLog.where({ action: "AIRTABLE_SYNC_SUCCESS" })
		.where(entry => entry.targetId.in(pending.map(p => p.id)))
		.select("createdAt", "metadata", "targetId")
		.all()

	const out: { themeProjectId: string; phase: Phase }[] = []
	for (const p of pending)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const status = statusFor(p, phase)
			if (status !== PhaseStatus.in_review) continue
			const submittedAt = p.submissions.find(s => s.phase === phase)?.createdAt
			// Written since the latest hand-in counts; an older write was for a submission that has since been taken back and handed in again.
			const written = synced.some(s => {
				const meta = isRecord(s.metadata) ? s.metadata : null
				return (
					s.targetId === p.id
					&& meta?.phase === phase
					&& typeof meta.recordId === "string"
					&& (!submittedAt || s.createdAt >= submittedAt)
				)
			})
			if (!written) out.push({ phase, themeProjectId: p.id })
		}

	return out
}
