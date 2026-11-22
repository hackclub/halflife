import "server-only"
import { getAirtableConfig } from "@/lib/airtable/client"
import { deflationFor, numberCell } from "@/lib/airtable/deflation"
import { fieldKey, YSWS_SUBMISSION } from "@/lib/airtable/schema"
import { lastRecordId, recordIdsFromSyncEvents, yswsFieldsFor } from "@/lib/airtable/sync"
import {
	hoursCell,
	isUnifiedFieldKey,
	MAX_SCREENSHOTS,
	parseUnifiedOverrides,
	UNIFIED_EDITABLE,
	type UnifiedFieldValues,
	type UnifiedOverrides,
	unifiedCell,
} from "@/lib/airtable/unified-overrides"
import { readUnifiedSubmitted, updateYswsRecord } from "@/lib/airtable/ysws"
import { projectDisplayTitle } from "@/lib/config/program"
import { displayName } from "@/lib/display-name"
import { Phase, PhaseStatus, ReviewPass, ReviewResult } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { round2 } from "@/lib/money"
import { statusFor } from "@/lib/phase"
import db from "@/lib/prisma8"
import { getProgramSettings } from "@/lib/program"
import type { UnifiedReviewDetail } from "@/lib/review-platform/types"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"
import { isRecord } from "@/lib/unknown"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * T2: the admin's look at a website approval before it goes to the unified database – Fabricate's `Admin::UnifiedReviewsController` and `AirtableFieldMapper`, on Half Life's row.
 *
 * A website approval is decided and paid in Half Life, and its row is written to the YSWS base, but nothing sends it on until an admin has checked the fields the unified database receives – who the maker is, where to ship to, the hours and the justification – corrected any of them, and approved it here, which ticks `Automation - Submit to Unified YSWS`. Grant cards wait on the row reaching the unified database (see `readUnifiedSubmitted`), so this is also the step a funded design waits on.
 *
 * Ari's decisions are not part of it: Ari has its own second pass, and those rows are still sent on by hand in the base.
 */

const SHORT_DATE: Intl.DateTimeFormatOptions = Object.freeze({
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	month: "short",
	year: "numeric",
})

const shortStamp = (at: string): string => parseDbTimestamp(at).toLocaleString("en-US", SHORT_DATE)

interface Waiting {
	createdAt: string
	id: string
	phase: Phase
	reviewerId: string | null
	themeProjectId: string
	userId: string
}

/**
 * Website approvals still standing that have not reached the unified database, oldest first.
 *
 * A website approval is one with a Half Life reviewer: Ari's carry none. One whose phase has since left `approved` – an un-approval, or a reversal still settling – is not waiting for anything.
 */
async function waitingApprovals(): Promise<Waiting[]> {
	const reviews = await db.orm.public.SubmissionReview.where({
		invalidated: false,
		pass: ReviewPass.FINAL,
		result: ReviewResult.APPROVED,
	})
		.where(review => review.reviewerId.isNotNull())
		.where(review => review.unifiedApprovedAt.isNull())
		.select("createdAt", "id", "reviewerId")
		.include("submission", submission =>
			submission
				.select("phase", "themeProjectId")
				.include("themeProject", project => project.select("buildStatus", "deletedAt", "designStatus", "userId")),
		)
		.orderBy(review => review.createdAt.asc())
		.all()
	const waiting: Waiting[] = []
	for (const review of reviews) {
		const project = review.submission?.themeProject
		if (!review.submission || !project || project.deletedAt) continue
		if (statusFor(project, review.submission.phase) !== PhaseStatus.approved) continue
		waiting.push({
			createdAt: review.createdAt,
			id: review.id,
			phase: review.submission.phase,
			reviewerId: review.reviewerId,
			themeProjectId: review.submission.themeProjectId,
			userId: project.userId,
		})
	}
	return waiting
}

/**
 * Mark the approvals whose rows already reached the unified database – ticked by hand in the base, or before T2 existed – so they leave the queue. Fabricate's `UnifiedSubmissionSyncJob`, run when the queue is read rather than on a timer.
 *
 * `unifiedApprovedById` stays null for these: nobody approved them at T2. An unreadable base settles nothing, so a bad day leaves the queue longer rather than shorter.
 */
async function settleAlreadySent(waiting: readonly Waiting[]): Promise<Set<string>> {
	if (waiting.length === 0) return new Set()
	const projectIds = [...new Set(waiting.map(item => item.themeProjectId))]
	const events = await db.orm.public.AuditLog.where({ action: "AIRTABLE_SYNC_SUCCESS" })
		.where(entry => entry.targetId.in(projectIds))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const recordIds = recordIdsFromSyncEvents(events)
	const recordOf = (item: Waiting): string | undefined => recordIds.get(`${item.themeProjectId}:${item.phase}`)
	const submitted = await readUnifiedSubmitted(
		waiting.map(recordOf).filter((id): id is string => typeof id === "string"),
	)
	if (!submitted) return new Set()
	const settled = waiting.filter(item => {
		const recordId = recordOf(item)
		return recordId !== undefined && submitted.has(recordId)
	})
	if (settled.length > 0)
		await db.orm.public.SubmissionReview.where(review => review.id.in(settled.map(item => item.id)))
			.where(review => review.unifiedApprovedAt.isNull())
			.updateAll({ unifiedApprovedAt: formatDbTimestamp(new Date()) })
	return new Set(settled.map(item => item.id))
}

/** What waits for this admin at T2: nobody checks their own project. */
export async function unifiedQueue(viewerId: string): Promise<string[]> {
	const waiting = await waitingApprovals()
	const sent = await settleAlreadySent(waiting)
	return waiting.filter(item => !sent.has(item.id) && item.userId !== viewerId).map(item => item.id)
}

/** Every editable column, from a map that may lack some: a missing one reads as empty. Listed out so the compiler checks it against `UNIFIED_EDITABLE`. */
const unifiedDefaults = (from: { [_: string]: string }): UnifiedFieldValues => ({
	addressLine1: from.addressLine1 ?? "",
	addressLine2: from.addressLine2 ?? "",
	birthday: from.birthday ?? "",
	city: from.city ?? "",
	codeUrl: from.codeUrl ?? "",
	country: from.country ?? "",
	description: from.description ?? "",
	email: from.email ?? "",
	firstName: from.firstName ?? "",
	githubUsername: from.githubUsername ?? "",
	lastName: from.lastName ?? "",
	overrideHoursSpent: from.overrideHoursSpent ?? "",
	overrideHoursSpentJustification: from.overrideHoursSpentJustification ?? "",
	playableUrl: from.playableUrl ?? "",
	slackId: from.slackId ?? "",
	state: from.state ?? "",
	zip: from.zip ?? "",
})

/** A cell as the form's text. */
const cellText = (value: unknown): string =>
	typeof value === "string" ? value : typeof value === "number" ? String(value) : ""

interface Generated {
	claimedHours: number | null
	fields: UnifiedFieldValues
	screenshots: string[]
}

/**
 * What Half Life would put in each T2 column on its own: the row as hand-in writes it, with the hours and justification the decision wrote.
 *
 * The hours are the decision's figure – the approved total when the review cut the claim, else the claim – which is what `Optional - Override Hours Spent` holds after the decision (see `deflationColumns` in lib/airtable/sync). The justification is the approval's own account (see lib/review-platform/justification).
 */
async function generatedValues(review: {
	justification: string | null
	phase: Phase
	themeProjectId: string
}): Promise<Generated> {
	const [cells, project] = await Promise.all([
		yswsFieldsFor(review.themeProjectId, review.phase, { preview: true }),
		db.orm.public.ThemeProject.whereUnique({ id: review.themeProjectId })
			.select("approvedHours", "designApprovedHours")
			.first(),
	])
	if (!cells || !project) throw new HttpError("NOT_FOUND", "The project behind this approval is gone")
	const claimed = numberCell(cells[fieldKey(YSWS_SUBMISSION.fields.hoursSelfReported)])
	const approved = review.phase === Phase.DESIGN ? project.designApprovedHours : project.approvedHours
	const hours =
		approved === null ? claimed : (deflationFor(approved, claimed)?.approvedHours ?? claimed ?? round2(approved))
	const fields: { [_: string]: string } = Object.fromEntries(
		UNIFIED_EDITABLE.map(key => [key, cellText(cells[fieldKey(YSWS_SUBMISSION.fields[key])])]),
	)
	const values: UnifiedFieldValues = {
		...unifiedDefaults(fields),
		overrideHoursSpent: hours === null ? "" : String(hours),
		overrideHoursSpentJustification: review.justification ?? "",
	}
	const shots: unknown = cells[fieldKey(YSWS_SUBMISSION.fields.screenshot)]
	const screenshots = Array.isArray(shots)
		? shots.flatMap((shot: unknown) => (isRecord(shot) && typeof shot.url === "string" ? [shot.url] : []))
		: []
	return { claimedHours: claimed, fields: values, screenshots }
}

/** The images a screenshot can be picked from: the cover, the hand-in's attachments, then the phase's journal images. */
async function screenshotOptions(submission: {
	attachmentKeys: readonly (string | null)[] | null
	phase: Phase
	themeProjectId: string
}): Promise<string[]> {
	const [project, sessions] = await Promise.all([
		db.orm.public.ThemeProject.whereUnique({ id: submission.themeProjectId }).select("coverImageKey").first(),
		db.orm.public.WorkSession.where({
			deletedAt: null,
			phase: submission.phase,
			themeProjectId: submission.themeProjectId,
		})
			.include("media", media => media.orderBy(m => m.sortOrder.asc()))
			.orderBy(session => session.createdAt.asc())
			.all(),
	])
	const keys = [
		project?.coverImageKey ?? null,
		...(submission.attachmentKeys ?? []),
		...sessions.flatMap(session => session.media.map(m => m.objectKey)),
	]
	const urls = keys.map(key => publicUrlFor(key ?? null)).filter((url): url is string => Boolean(url))
	return [...new Set(urls)]
}

/** Why the row can't be written from here, or null when it can. */
async function airtableProblem(themeProjectId: string, phase: Phase): Promise<string | null> {
	const settings = await getProgramSettings()
	if (!settings.airtableSyncEnabled) return "Airtable sync is off in the program settings, so nothing can be sent."
	if (!getAirtableConfig()) return "Airtable isn't configured on this deployment, so nothing can be sent."
	if (!(await lastRecordId(themeProjectId, phase)))
		return "This hand-in has no Airtable row. Retry its sync from the project's admin page first."
	return null
}

/** The approval as T2 shows it, or null when it is not a standing website approval this admin may check. */
export async function getUnifiedReview(reviewId: string, viewerId: string): Promise<UnifiedReviewDetail | null> {
	const review = await db.orm.public.SubmissionReview.whereUnique({ id: reviewId })
		.include("reviewer", reviewer => reviewer.select("displayName", "name"))
		.include("unifiedApprovedBy", admin => admin.select("displayName", "name"))
		.include("submission", handIn =>
			handIn.include("themeProject", owned => owned.include("user", user => user.select("displayName", "id", "name"))),
		)
		.first()
	const submission = review?.submission
	const project = submission?.themeProject
	const maker = project?.user
	if (!review || !submission || !project || !maker || project.deletedAt) return null
	if (review.invalidated || review.result !== ReviewResult.APPROVED || review.reviewerId === null) return null
	if (project.userId === viewerId) return null

	const [generated, options, problem, queue] = await Promise.all([
		generatedValues({ justification: review.justification, phase: submission.phase, themeProjectId: project.id }),
		screenshotOptions(submission),
		airtableProblem(project.id, submission.phase),
		review.unifiedApprovedAt ? Promise.resolve(null) : unifiedQueue(viewerId),
	])
	const overrides = parseUnifiedOverrides(review.unifiedOverrides)
	const screenshots = overrides.screenshots ?? generated.screenshots

	// A build goes to the unified database after its design, so the screen says whether the design is there yet.
	let designSentAt: string | null = null
	if (submission.phase === Phase.BUILD) {
		const design = await db.orm.public.SubmissionReview.where({ invalidated: false, result: ReviewResult.APPROVED })
			.where(row => row.submission.some(other => other.themeProjectId.eq(project.id)))
			.where(row => row.submission.some(other => other.phase.eq(Phase.DESIGN)))
			.orderBy(row => row.createdAt.desc())
			.select("unifiedApprovedAt")
			.first()
		designSentAt = design?.unifiedApprovedAt ? shortStamp(design.unifiedApprovedAt) : ""
	}

	const index = queue ? queue.indexOf(review.id) : -1
	const others = queue ? queue.filter(id => id !== review.id) : []
	return {
		airtableProblem: problem,
		claimedHours: generated.claimedHours ?? 0,
		designSentAt,
		fields: UNIFIED_EDITABLE.map(key => ({
			generated: generated.fields[key],
			key,
			label: YSWS_SUBMISSION.fields[key].name,
			value: overrides.fields[key] ?? generated.fields[key],
		})),
		generatedScreenshots: generated.screenshots,
		id: review.id,
		kind: submission.phase === Phase.DESIGN ? "design" : "build",
		makerName: displayName(maker, "A maker"),
		maxScreenshots: MAX_SCREENSHOTS,
		// The next one after this in the queue, wrapping round, as Fabricate's Skip does.
		nextId: (index >= 0 ? (queue?.slice(index + 1).find(id => id !== review.id) ?? others[0]) : others[0]) ?? null,
		position: index >= 0 ? index + 1 : null,
		projectId: project.id,
		projectName: projectDisplayTitle(project),
		reviewedAt: shortStamp(review.createdAt),
		reviewerName: displayName(review.reviewer, review.reviewerName ?? "A reviewer"),
		screenshotOptions: [...new Set([...screenshots, ...generated.screenshots, ...options])],
		screenshots,
		sent: review.unifiedApprovedAt
			? { at: shortStamp(review.unifiedApprovedAt), by: displayName(review.unifiedApprovedBy) }
			: null,
		submissionId: submission.id,
		tier: review.tierOverride ?? review.frozenTier,
		total: queue?.length ?? 0,
	}
}

const isHttpUrl = (url: string): boolean => {
	try {
		const parsed = new URL(url)
		return parsed.protocol === "http:" || parsed.protocol === "https:"
	} catch {
		return false
	}
}

export interface UnifiedSaveInput {
	/** True to tick `Automation - Submit to Unified YSWS` once the fields are written. */
	approve: boolean
	fields: { [_: string]: string }
	screenshots: string[]
}

/**
 * Save an admin's T2 fields and write them to the row, and on approval send it to the unified database.
 *
 * Only the fields that differ from Half Life's own values are kept as overrides, so later writes of the row keep the admin's corrections and still pick up everything else (see lib/airtable/unified-overrides). The row itself is written whole – every T2 column as the screen showed it – because that is what the admin checked.
 *
 * The approval is stamped only after Airtable took the write. A refused write leaves the approval waiting, with the overrides saved, so a second try needs nothing re-typed.
 */
export async function saveUnifiedReview(
	reviewId: string,
	adminId: string,
	input: UnifiedSaveInput,
): Promise<{ sent: boolean }> {
	const review = await db.orm.public.SubmissionReview.whereUnique({ id: reviewId })
		.select("id", "invalidated", "justification", "result", "reviewerId", "unifiedApprovedAt")
		.include("submission", handIn =>
			handIn
				.select("phase", "themeProjectId")
				.include("themeProject", owned => owned.select("buildStatus", "deletedAt", "designStatus", "userId")),
		)
		.first()
	const submission = review?.submission
	const project = submission?.themeProject
	if (!review || !submission || !project || project.deletedAt || review.reviewerId === null)
		throw new HttpError("NOT_FOUND", "No such website approval")
	if (review.invalidated || review.result !== ReviewResult.APPROVED)
		throw new HttpError("CONFLICT", "This approval no longer stands")
	if (statusFor(project, submission.phase) !== PhaseStatus.approved)
		throw new HttpError("PHASE_LOCKED", "This phase is no longer approved")
	if (project.userId === adminId) throw new HttpError("FORBIDDEN", "You can't send your own project to Unified")
	if (input.approve && review.unifiedApprovedAt)
		throw new HttpError("ALREADY_RESOLVED", "This approval was already sent to Unified")

	const generated = await generatedValues({
		justification: review.justification,
		phase: submission.phase,
		themeProjectId: submission.themeProjectId,
	})

	const overrides: UnifiedOverrides = { fields: {} }
	const values = { ...generated.fields }
	for (const [key, text] of Object.entries(input.fields)) {
		if (!isUnifiedFieldKey(key)) continue
		if (key === "overrideHoursSpent" && text.trim() !== "" && hoursCell(text) === null)
			throw new HttpError("VALIDATION_FAILED", "Hours spent must be a number of 0 or more")
		values[key] = text.trim()
		if (unifiedCell(key, text) !== unifiedCell(key, generated.fields[key])) overrides.fields[key] = text.trim()
	}

	const screenshots = [...new Set(input.screenshots.map(url => url.trim()).filter(Boolean))]
	if (screenshots.length > MAX_SCREENSHOTS)
		throw new HttpError("VALIDATION_FAILED", `Pick at most ${MAX_SCREENSHOTS} screenshots`)
	if (!screenshots.every(isHttpUrl)) throw new HttpError("VALIDATION_FAILED", "Screenshots must be http(s) links")
	if (input.approve && screenshots.length === 0)
		throw new HttpError("VALIDATION_FAILED", "Pick at least one screenshot")
	if (screenshots.join("\n") !== generated.screenshots.join("\n")) overrides.screenshots = screenshots

	await db.orm.public.SubmissionReview.where({ id: review.id }).updateAll({
		// Spread into a plain object, which is what the JSON column takes.
		unifiedOverrides:
			overrides.screenshots || Object.keys(overrides.fields).length > 0
				? {
						fields: { ...overrides.fields },
						...(overrides.screenshots ? { screenshots: [...overrides.screenshots] } : {}),
					}
				: null,
	})

	const problem = await airtableProblem(submission.themeProjectId, submission.phase)
	const recordId = await lastRecordId(submission.themeProjectId, submission.phase)
	if (problem || !recordId) throw new HttpError("NOT_CONFIGURED", problem ?? "This hand-in has no Airtable row")

	const cells: { [_: string]: unknown } = {}
	for (const key of UNIFIED_EDITABLE) cells[fieldKey(YSWS_SUBMISSION.fields[key])] = unifiedCell(key, values[key])
	cells[fieldKey(YSWS_SUBMISSION.fields.screenshot)] = screenshots.map(url => ({ url }))
	if (input.approve) cells[fieldKey(YSWS_SUBMISSION.fields.submitToUnified)] = true
	const written = await updateYswsRecord(recordId, cells)
	if (!written.ok)
		throw new HttpError(
			"UNAVAILABLE",
			written.reason === "row_gone"
				? "The Airtable row is gone. Retry the hand-in's sync from the project's admin page."
				: `Airtable refused the write: ${written.reason}`,
		)

	if (!input.approve) return { sent: false }
	await db.orm.public.SubmissionReview.where({ id: review.id })
		.where(row => row.unifiedApprovedAt.isNull())
		.updateAll({ unifiedApprovedAt: formatDbTimestamp(new Date()), unifiedApprovedById: adminId })
	return { sent: true }
}
