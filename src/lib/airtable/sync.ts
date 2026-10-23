import "server-only"
import { Phase, PhaseStatus, ReviewResult } from "@/app/generated/prisma/enums"
import { getAirtableConfig } from "@/lib/airtable/client"
import { existingColumns } from "@/lib/airtable/field-probe"
import { justificationValues, timelapseLinks } from "@/lib/airtable/justification"
import { fieldKey, LOOPS_REVIEW_OVERRIDE, toFields, YSWS_REVIEW_STATUS, YSWS_SUBMISSION } from "@/lib/airtable/schema"
import { deleteUnifiedRecords, deleteYswsRecord, updateYswsRecord, writeYswsRecord } from "@/lib/airtable/ysws"
import { bomTotalUsd } from "@/lib/bom-policy"
import { projectDisplayTitle, scheduledWeekFor } from "@/lib/config/program"
import { syncHcaProfile } from "@/lib/hca-profile"
import { getHoursBreakdown } from "@/lib/hours"
import { lockKey } from "@/lib/locks"
import { round2 } from "@/lib/money"
import { statusFor } from "@/lib/phase"
import { decryptUserPII } from "@/lib/pii"
import prisma from "@/lib/prisma"
import { getProgramSettings } from "@/lib/program"
import { findRepoFile } from "@/lib/repo-checks"
import { repoRefFromLink } from "@/lib/repo-ref"
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
	const rows = await prisma.auditLog.findMany({
		orderBy: { createdAt: "desc" },
		select: { metadata: true },
		take: 50,
		where: { action: "AIRTABLE_SYNC_SUCCESS", targetId: themeProjectId },
	})
	for (const row of rows) {
		const meta = row.metadata as { phase?: string; recordId?: string; removed?: boolean } | null
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
		const meta = row.metadata as { phase?: string; recordId?: string; removed?: boolean } | null
		if (!row.targetId || !meta?.phase) continue
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
 * The poller compares values to decide whether a field changed, and the
 * dispatcher's override strategy then always sends whatever is in the envelope.
 * A decision on the same project, or two decisions that name the same week,
 * would otherwise write the same value the field already holds and be invisible
 * to the poller. The stamp changes the source value without changing what the
 * email renders.
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
 * Exported so the field names and the week label can be checked without a
 * database or an Airtable call: a typo in either name is the difference
 * between email-tools recognising the field and ignoring it.
 */
export function reviewOverrideValues(title: string, week: number | null): { [_: string]: string } {
	return {
		[LOOPS_REVIEW_OVERRIDE.projectName]: overrideStamp(title),
		[LOOPS_REVIEW_OVERRIDE.projectWeek]: overrideStamp(projectWeekLabel(week ?? 0) ?? ""),
	}
}

/** The fields for this submission, exactly as the table names them. */
async function fieldsFor(themeProjectId: string, phase: Phase) {
	const project = await prisma.themeProject.findUnique({
		include: {
			bomItems: { select: { name: true, purpose: true, quantity: true, unitCostUsd: true } },
			hackatimeLinks: { select: { hackatimeProject: true }, where: { phase } },
			workSessions: {
				orderBy: { createdAt: "asc" },
				select: {
					content: true,
					createdAt: true,
					effectiveDate: true,
					hoursClaimed: true,
					timelapses: { select: { externalId: true, objectKey: true, playbackUrl: true, provider: true } },
					title: true,
				},
				where: { deletedAt: null, phase },
			},
		},
		where: { id: themeProjectId },
	})
	if (!project) return null

	// Fresh from HCA, so the address a grant ships to is the one on file today rather than the one from whenever they last signed in.
	await syncHcaProfile(project.userId)
	const user = await prisma.user.findUniqueOrThrow({ where: { id: project.userId } })
	const pii = decryptUserPII(user)

	const week = scheduledWeekFor(project.theme, phase)
	const settings = await getProgramSettings()

	const breakdown = await getHoursBreakdown(themeProjectId, phase)
	const bomTotal = bomTotalUsd(project.bomItems, project.bomTaxShippingUsd)

	// A design is judged from its repo; a build from the video of it working – the closing reel the submit sheet asks for, posted under this week's key.
	let playableUrl = project.githubRepo ?? ""
	if (phase === Phase.BUILD) {
		const demo = await prisma.post.findFirst({
			orderBy: { createdAt: "desc" },
			select: { objectKey: true },
			where: {
				checkpointKey: `w${week}-reel-submission`,
				deletedAt: null,
				userId: project.userId,
			},
		})
		playableUrl = publicUrlFor(demo?.objectKey ?? null) ?? playableUrl
	}

	const lapseLinks = timelapseLinks(project.workSessions.flatMap(s => s.timelapses))

	const [firstName, ...rest] = (user.name ?? "").trim().split(/\s+/)
	const tier = project.tier ?? project.requestedTier
	const journalUrl = await findRepoFile(project.githubRepo, /(^|\/)journal\.md$/i)
	const cover = publicUrlFor(project.coverImageKey)

	const justification = justificationValues(
		{
			bomItems: project.bomItems,
			description: project.description,
			hackatimeProjects: project.hackatimeLinks.map(l => l.hackatimeProject),
			hackatimeUserId: user.hackatimeUserId,
			lapseLinks,
			workSessions: project.workSessions,
		},
		{ eventStart: settings.eventStartDate, phase, theme: project.theme },
	)

	const fields = toFields(YSWS_SUBMISSION.fields, {
		codeUrl: project.githubRepo ?? "",
		email: user.email,
		firstName: firstName ?? "",
		lastName: rest.join(" "),
		...(pii.birthday ? { birthday: pii.birthday } : {}),
		addressLine1: pii.line1 ?? "",
		addressLine2: pii.line2 ?? "",
		city: pii.city ?? "",
		country: pii.country ?? "",
		description: project.description ?? "",
		// A GitHub-only field: for a repo on another forge there is no GitHub username to send, and the repo URL is carried in its own column anyway.
		githubUsername: (() => {
			const ref = repoRefFromLink(project.githubRepo)
			return ref?.forge.id === "github" ? ref.ownerPath : ""
		})(),
		// The `Justification - …` columns, spread rather than listed: a column we have nothing for is left out of the payload entirely, so a blank is never written over evidence the base already holds (see lib/airtable/justification).
		...justification,
		hoursSelfReported: round2(breakdown.journalHoursClaimed + breakdown.hackatimeHours),
		journalUrl: journalUrl ?? "",
		playableUrl,
		projectName: project.title,
		projectWeek: projectWeekLabel(week) ?? undefined,
		// The parts are funded once, at design. A build asks for no new money, so its row says $0 rather than repeating the design's request.
		requestedFunding: phase === Phase.DESIGN ? bomTotal : 0,
		reviewStatus: reviewStatusFor(phase === Phase.DESIGN ? project.designStatus : project.buildStatus),
		slackId: user.slackId ?? "",
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
 * The record id is only known from an audit row written after a successful write, so two callers can arrive before either row exists – the submit `after` hook and the hourly retry job, or an admin's Retry button racing either. Both read "no row yet", both find nothing to adopt, and both POST a
 * new "Pending Review" row into the payout sink. Postgres serializes them
 * here: the loser runs its lookup after the winner's row exists and adopts it instead of creating a second.
 *
 * An advisory xact lock releases with the transaction. The work inside is HTTP, so the transaction gets a generous timeout rather than the default 5 seconds, which would release the lock in the middle of Airtable's own retry backoff.
 */
function withYswsWriteLock<T>(themeProjectId: string, phase: Phase, fn: () => Promise<T>): Promise<T> {
	return prisma.$transaction(
		async tx => {
			await lockKey(tx, `ysws:${themeProjectId}:${phase}`)
			return fn()
		},
		{ maxWait: 30_000, timeout: 120_000 },
	)
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
		writeYswsRecord(fields, await lastRecordId(themeProjectId, phase)),
	)
}

/**
 * Move a submission's row on to the decision Ari just reached: the status Loops
 * triggers on, the reviewer's note the email quotes, and the project and week
 * that decision is about.
 *
 * The email-tools poller only forwards a `Loops - …` field when the value on
 * that row changed. The row's `Loops - halfLifeProjectName` and
 * `Loops - halfLifeProjectWeek` are written at submit and never change on a
 * decision, so the poller never re-sends them; the contact keeps whatever was
 * submitted most recently. The `Loops - Override - …` columns are separate
 * fields, so writing them here is a change the poller forwards, and email-tools
 * maps them onto the same contact property with its override strategy. The
 * status trigger and the project it names then arrive in one contact update.
 *
 * Half Life writes the row as "Pending Review" and reviewers work from
 * ari.hackclub.com, but a decision there changes nothing in the base – without
 * this the status sits at "Pending Review" forever and the note is never
 * written (see YSWS_REVIEW_STATUS in lib/airtable/schema).
 *
 * Best-effort, and only ever after the fact: the review is already committed in
 * Postgres by the time this runs, so a base that is briefly unreachable must not
 * throw and turn a decided submission into one Ari redelivers. No row is not a
 * failure either – a submission written before this sync existed has no record
 * id, and one taken back has none any more.
 *
 * The status, note, first-pass reviewer and overrides are written together in
 * the ordinary case. If that request is refused, the fallback keeps the status
 * load-bearing: status + overrides, then status alone, then the note and the
 * reviewer. Each failure is named.
 *
 * `reviewerEmail` is Ari's `review.reviewer.email`, the reviewer who made the
 * decision (the first of Ari's two passes). Omitting it leaves the column
 * alone; passing null clears it for a decision that no longer stands.
 */
export async function syncReviewDecisionToYsws(
	themeProjectId: string,
	phase: Phase,
	status: string,
	note: string | null,
	reviewerEmail?: string | null,
): Promise<{ updated: boolean; reason?: string; noteFailed?: string; reviewerFailed?: string }> {
	const settings = await getProgramSettings()
	if (!settings.airtableSyncEnabled) return { reason: "sync_disabled", updated: false }
	// The id lives in the audit row each successful write left (see lastRecordId), not in a column of ours.
	const recordId = await lastRecordId(themeProjectId, phase)
	if (!recordId) return { reason: "no_row", updated: false }

	const { pass1Reviewer, reviewStatus, reviewerNotes } = YSWS_SUBMISSION.fields
	const statusField = { [fieldKey(reviewStatus)]: status }
	const noteField = { [fieldKey(reviewerNotes)]: note ?? "" }
	// Undefined leaves the column alone, for a caller that only knows about the status (the older review backfill). Null clears it, for a decision that no longer stands.
	const reviewerField = reviewerEmail === undefined ? null : { [fieldKey(pass1Reviewer)]: reviewerEmail ?? "" }

	// The override and reviewer columns may not exist yet on a base that predates them. Airtable rejects a whole PATCH for one unknown field, so ask first and leave them out when absent rather than losing the status with them.
	const overrides: { [_: string]: unknown } = {}
	let reviewerWritable = false
	const config = getAirtableConfig()
	if (config)
		try {
			const writable = await existingColumns(config, YSWS_SUBMISSION.tableId, [
				...Object.values(LOOPS_REVIEW_OVERRIDE),
				pass1Reviewer.name,
			])
			reviewerWritable = writable.has(pass1Reviewer.name)
			if (writable.size > 0) {
				const [project, submission] = await Promise.all([
					prisma.themeProject.findUnique({
						select: { theme: true, title: true },
						where: { id: themeProjectId },
					}),
					prisma.phaseSubmission.findFirst({
						orderBy: { createdAt: "desc" },
						select: { scheduledWeek: true },
						where: { phase, themeProjectId },
					}),
				])
				if (project) {
					const week = submission?.scheduledWeek ?? scheduledWeekFor(project.theme, phase)
					const values = reviewOverrideValues(projectDisplayTitle(project), week)
					for (const [field, value] of Object.entries(values)) if (writable.has(field)) overrides[field] = value
				}
			}
		} catch (err) {
			// A probe failure is not a reason to lose the status; the next decision retries it.
			console.error(
				"[airtable] could not probe the Loops override and reviewer columns; writing the decision without them:",
				err,
			)
		}

	const complete = {
		...statusField,
		...noteField,
		...(reviewerWritable && reviewerField ? reviewerField : {}),
		...overrides,
	}
	const moved = await updateYswsRecord(recordId, complete)
	if (moved.ok) return { updated: true }

	// The complete write was refused. Keep the status load-bearing, and keep the overrides with it so the email can still name the project.
	const core = await updateYswsRecord(recordId, { ...statusField, ...overrides })
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
 * Every decision path calls this once its own change has committed – the Ari webhook, the review console, and an admin's un-approve or reopen – so the row cannot be moved by one path and left behind by another. `status` is the state the phase is now in, `note` is the reviewer's own words, and `reviewerEmail` is who made the decision, each null to clear its column.
 *
 * Never throws: the review is already committed when this runs, so a failure is logged rather than raised. On the Ari path that is load-bearing – a throw becomes a 5xx and a redelivery of a decision that has already been applied.
 */
export async function mirrorReviewDecision(
	themeProjectId: string,
	phase: Phase,
	status: string,
	note: string | null,
	reviewerEmail?: string | null,
): Promise<void> {
	const mirrored = await syncReviewDecisionToYsws(themeProjectId, phase, status, note, reviewerEmail)
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
	const pending = await prisma.themeProject.findMany({
		select: {
			buildStatus: true,
			designStatus: true,
			id: true,
			submissions: { orderBy: { createdAt: "desc" }, select: { createdAt: true, phase: true } },
		},
		where: {
			deletedAt: null,
			OR: [{ designStatus: PhaseStatus.in_review }, { buildStatus: PhaseStatus.in_review }],
		},
	})
	if (pending.length === 0) return []

	const synced = await prisma.auditLog.findMany({
		select: { createdAt: true, metadata: true, targetId: true },
		where: { action: "AIRTABLE_SYNC_SUCCESS", targetId: { in: pending.map(p => p.id) } },
	})

	const out: { themeProjectId: string; phase: Phase }[] = []
	for (const p of pending)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const status = statusFor(p, phase)
			if (status !== PhaseStatus.in_review) continue
			const submittedAt = p.submissions.find(s => s.phase === phase)?.createdAt
			// Written since the latest hand-in counts; an older write was for a submission that has since been taken back and handed in again.
			const written = synced.some(s => {
				const meta = s.metadata as { phase?: string; recordId?: string } | null
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
