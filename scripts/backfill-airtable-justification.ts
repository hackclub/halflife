import {
	AirtableListSchema,
	type AirtableRecord,
	airtableFetch,
	getAirtableConfig,
	withRateLimitRetry,
} from "../src/lib/airtable/client"
import { columnExists } from "../src/lib/airtable/field-probe"
import {
	alternateTrackingJustification,
	type JustificationValues,
	justificationValues,
	NO_FEATURES_RECORDED,
	specificTechnicalFeatures,
	timelapseLinks,
} from "../src/lib/airtable/justification"
import { type FieldDef, fieldKey, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { recordIdsFromSyncEvents, reviewStatusFor, reviewStatusForResult } from "../src/lib/airtable/sync"
import { updateYswsRecord } from "../src/lib/airtable/ysws"
import { defaultFeedback } from "../src/lib/ari"
import { AuditAction, HoursSource, Phase, PhaseStatus, type ReviewResult } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { getProgramSettings } from "../src/lib/program"
import { withFields } from "../src/lib/rows"
import { parseDbTimestamp } from "../src/lib/time"

/**
 * Fill the `Justification - …` columns on the submission rows that are missing them.
 *
 * Five columns carry a submission's evidence: the maker's Hackatime id, the Hackatime projects they tracked time in, the timelapses they recorded, the account of what they actually built, and – when there is neither Hackatime nor Lapse evidence – the devlog-based method the hours rest on. The pipeline merges them into one blob on the row (`Automation - Unified Justification`), so a column left empty is a gap in the justification a grant reviewer reads.
 *
 * Rows written before the technical-features column was wired up are missing that column in particular: it existed in the base before `justificationValues` filled it, so every row from before that change has an empty `[SPECIFIC TECHNICAL FEATURES]` section. That column is required on every row, so this fills it even when the maker left nothing to build it from (see `NO_FEATURES_RECORDED`). The alternate-tracking column is filled only when the row has no Hackatime id, no Hackatime projects and no Lapse links; the other evidence columns are only written when we hold something.
 *
 * This replays the state Postgres already holds onto the rows that are missing a column, using the same builder the live write uses (see `justificationValues` in lib/airtable/justification), so a backfilled cell and a freshly written one cannot disagree. The reviewer's reasoning for the alternate method is the standing decision's audit note (`SubmissionReview.reason`), which is where Ari now puts the explanation that used to live in its legacy `time_evidence` and `hours_reasoning` fields.
 *
 * Only a column the base is missing is written. A column that already holds something is left exactly as it is: it is evidence, and on the pre-season rows the form filled it in and Postgres never received it, so overwriting it with our own answer would destroy the only record. A row is therefore never rewritten wholesale, only completed.
 *
 * The record id is not kept on the project. It is on the audit row each successful write left (`AIRTABLE_SYNC_SUCCESS`, the same source `lastRecordId` reads), so each (project, phase) is written at its newest id that has not since been `removed`; a row taken back on unsubmit is reported as gone rather than quietly recreated. A row with no project behind it – one the warm-up import has not reached yet, say – has no parts or journal to add, but its own `Description` is still the maker's account: the technical-features column is completed from it so no row is left without one. Everything else on such a row is left alone.
 *
 * Read-only unless `--commit` is passed. Run with `bun --conditions=react-server scripts/backfill-airtable-justification.ts [--commit]`. In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")

/** The columns this backfill fills, by the key `justificationValues` returns each one under. */
const COLUMNS = {
	alternateTracking: YSWS_SUBMISSION.fields.alternateTracking,
	hackatimeId: YSWS_SUBMISSION.fields.hackatimeId,
	hackatimeProjects: YSWS_SUBMISSION.fields.hackatimeProjects,
	lapseLinks: YSWS_SUBMISSION.fields.lapseLinks,
	specificTechnicalFeatures: YSWS_SUBMISSION.fields.specificTechnicalFeatures,
}

/** Columns read for the rows that have no local project; they are never written. */
const READ_ONLY = {
	description: YSWS_SUBMISSION.fields.description,
	projectName: YSWS_SUBMISSION.fields.projectName,
	stage: YSWS_SUBMISSION.fields.stage,
}

/** A string cell, or "" when Airtable has nothing there. */
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** A field's value, however the response keyed it: by name unless the caller asked for ids. */
const cell = (record: AirtableRecord, field: FieldDef): string =>
	text(record.fields[field.name] ?? record.fields[field.id])

/** What the base holds for one row, as far as this backfill cares. */
interface RowSnapshot {
	cells: Map<string, string>
	description: string
	stage: string
	title: string
}

/** The decision that still holds for a phase, as far as the alternate-tracking reasoning needs it. */
interface StandingReview {
	feedback: string
	reason: string | null
	result: ReviewResult
	reviewerId: string | null
}

/**
 * The reviewer's own explanation of the hours, or null when there is none worth quoting.
 *
 * Ari stores its required internal audit note on the review as `reason`; that is the current field that says how the evidence supports the time. The maker-facing note is the fallback for decisions recorded before the audit note existed, but Ari's generic fallback ("Approved by Ari.") is not a reason and is recognised and skipped.
 */
function reviewerReason(review: StandingReview | undefined): string | null {
	if (!review) return null
	const reason = review.reason?.trim()
	if (reason) return reason
	const feedback = review.feedback.trim()
	if (!feedback) return null
	if (review.reviewerId === null && feedback === defaultFeedback(review.result)) return null
	return feedback
}

/** Every row's current justification columns, by record id. */
async function currentRows(
	config: NonNullable<ReturnType<typeof getAirtableConfig>>,
	keys: Map<string, string>,
): Promise<Map<string, RowSnapshot>> {
	const byId = new Map<string, RowSnapshot>()
	const fieldsQs = [...keys.values(), ...Object.values(READ_ONLY).map(field => field.name)]
		.map(field => `fields%5B%5D=${encodeURIComponent(field)}`)
		.join("&")
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsJustification", () =>
			airtableFetch(
				AirtableListSchema,
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const record of page.records) {
			const cells = new Map<string, string>()
			for (const [key, field] of Object.entries(COLUMNS)) cells.set(key, cell(record, field))
			byId.set(record.id, {
				cells,
				description: cell(record, READ_ONLY.description),
				stage: cell(record, READ_ONLY.stage),
				title: cell(record, READ_ONLY.projectName),
			})
		}
		;({ offset } = page)
	} while (offset)
	return byId
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	// Probed by name, because `columnExists` reads Airtable's `UNKNOWN_FIELD_NAME` refusal; written by `fieldKey`, which is the id once the base is written by id.
	for (const field of Object.values(COLUMNS))
		if (!(await columnExists(config, YSWS_SUBMISSION.tableId, field.name))) {
			console.error(
				`The \`${field.name}\` column is not on ${YSWS_SUBMISSION.tableId}; create it in Airtable before backfilling.`,
			)
			process.exit(1)
		}

	const keys = new Map<string, string>()
	for (const [key, field] of Object.entries(COLUMNS)) keys.set(key, fieldKey(field))
	const featuresKey = keys.get("specificTechnicalFeatures") ?? YSWS_SUBMISSION.fields.specificTechnicalFeatures.name

	const projects = await db.orm.public.ThemeProject.select(
		"buildStatus",
		"description",
		"designStatus",
		"id",
		"theme",
		"title",
	)
		.include("bomItems", items => items.select("name", "purpose", "quantity"))
		.include("hackatimeLinks", links => links.select("hackatimeProject", "phase"))
		.include("user", user => user.select("hackatimeUserId"))
		.include("workSessions", sessions =>
			sessions
				.where({ deletedAt: null })
				.orderBy(session => session.createdAt.asc())
				.select("content", "createdAt", "effectiveDate", "hoursClaimed", "hoursSource", "phase", "title")
				.include("timelapses", timelapses => timelapses.select("externalId", "objectKey", "playbackUrl", "provider")),
		)
		.all()
	if (projects.length === 0) {
		console.log("No themed projects; nothing to backfill.")
		return
	}

	const events = await db.orm.public.AuditLog.where({ action: AuditAction.AIRTABLE_SYNC_SUCCESS })
		.where(entry => entry.targetId.in(projects.map(p => p.id)))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const records = recordIdsFromSyncEvents(events)
	const settings = await getProgramSettings()

	// The decision that still holds per phase, for the reviewer's own explanation when the alternate method is the only one there is.
	const reviews = await db.orm.public.SubmissionReview.where({ invalidated: false })
		.where(review => review.submission.some(submission => submission.themeProjectId.in(projects.map(p => p.id))))
		.orderBy(review => review.createdAt.desc())
		.select("feedback", "reason", "result", "reviewerId")
		.include("submission", submission => submission.select("phase", "themeProjectId"))
		.all()
	const standing = new Map<string, StandingReview>()
	for (const review of reviews) {
		const { submission } = review
		if (!submission) continue
		const key = `${submission.themeProjectId}:${submission.phase}`
		if (!standing.has(key)) standing.set(key, review)
	}

	const targets: { phase: Phase; recordId: string; title: string; values: JustificationValues }[] = []
	let withoutRow = 0
	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const recordId = records.get(`${project.id}:${phase}`)
			if (!recordId) {
				withoutRow++
				continue
			}
			const phaseSessions = project.workSessions.filter(s => s.phase === phase)
			const sessions = phaseSessions.map(s => withFields(s, { createdAt: parseDbTimestamp(s.createdAt) }))
			const hackatimeProjects = project.hackatimeLinks.filter(l => l.phase === phase).map(l => l.hackatimeProject)
			const hackatimeUserId = project.user?.hackatimeUserId ?? null
			const lapseLinks = timelapseLinks(sessions.flatMap(s => s.timelapses))
			const values = justificationValues(
				{
					bomItems: project.bomItems,
					description: project.description,
					hackatimeProjects,
					hackatimeUserId,
					lapseLinks,
					workSessions: sessions,
				},
				{ eventStart: settings.eventStartDate, phase, theme: project.theme },
			)
			// The alternate method is only the method when there is nothing tracked to name.
			const hasTrackedEvidence = Boolean(hackatimeUserId) || hackatimeProjects.length > 0 || lapseLinks.length > 0
			if (!hasTrackedEvidence) {
				const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
				const review = standing.get(`${project.id}:${phase}`)
				const matches = review && reviewStatusForResult(review.result) === reviewStatusFor(status)
				const manual = phaseSessions.filter(s => s.hoursSource !== HoursSource.HACKATIME_TRACKED)
				values.alternateTracking = alternateTrackingJustification({
					claimedHours: manual.reduce((sum, session) => sum + session.hoursClaimed, 0),
					entryCount: manual.length,
					reviewerText: matches && status === PhaseStatus.approved ? reviewerReason(review) : null,
				})
			}
			targets.push({ phase, recordId, title: project.title, values })
		}

	// Only the cells the base is missing are written: a cell that already holds something is left as it is.
	const current = await currentRows(config, keys)
	const updates: { fields: { [_: string]: string }; phase: Phase; recordId: string; title: string }[] = []
	const missing = new Map<string, number>()
	for (const key of Object.keys(COLUMNS)) missing.set(key, 0)
	let aligned = 0
	let gone = 0
	for (const target of targets) {
		const row = current.get(target.recordId)
		if (!row) {
			gone++
			continue
		}
		const fields: { [_: string]: string } = {}
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- verification script over an untyped source
		for (const [key, value] of Object.entries(target.values) as [string, string | undefined][]) {
			if (value === undefined) continue
			if (row.cells.get(key)) continue
			fields[keys.get(key) ?? key] = value
			missing.set(key, (missing.get(key) ?? 0) + 1)
		}
		if (Object.keys(fields).length === 0) {
			aligned++
			continue
		}
		updates.push({ fields, phase: target.phase, recordId: target.recordId, title: target.title })
	}

	// A row with no project still gets its technical features, from the account the maker wrote on the row itself. Nothing else on it is touched: without a project there is no parts list, journal or Hackatime link to add.
	const targeted = new Set(targets.map(target => target.recordId))
	let fromRow = 0
	for (const [recordId, row] of current) {
		if (targeted.has(recordId)) continue
		if (row.cells.get("specificTechnicalFeatures")) continue
		const phase = row.stage === "Build" ? Phase.BUILD : Phase.DESIGN
		const features = specificTechnicalFeatures(
			{
				bomItems: [],
				description: row.description || null,
				hackatimeProjects: [],
				hackatimeUserId: null,
				lapseLinks: [],
				workSessions: [],
			},
			phase,
		)
		updates.push({
			fields: { [featuresKey]: features || NO_FEATURES_RECORDED },
			phase,
			recordId,
			title: row.title,
		})
		fromRow++
	}

	const withProject = targets.filter(target => current.has(target.recordId)).length
	console.log(
		`Projects: ${projects.length}; Airtable rows in the base: ${current.size}; rows with a project behind them: ${withProject} (${withoutRow} phase(s) never written, ${gone} row(s) since deleted)`,
	)
	console.log(`aligned: ${aligned}, to update: ${updates.length}`)
	for (const [key, field] of Object.entries(COLUMNS))
		console.log(`  ${field.name}: ${missing.get(key) ?? 0} cell(s) to fill`)
	if (fromRow > 0)
		console.log(
			`  ${fromRow} row(s) with no project: the technical features are completed from the row's own Description`,
		)
	for (const update of updates.slice(0, 10))
		console.log(`  ${update.phase}  ${update.title}  →  ${Object.keys(update.fields).join(", ")}`)
	if (updates.length > 10) console.log(`  …and ${updates.length - 10} more`)

	if (!commit) {
		console.log("Dry run. Pass --commit to fill the justification columns on these rows.")
		return
	}

	let updated = 0
	let rowGone = 0
	let failed = 0
	for (const update of updates) {
		const result = await updateYswsRecord(update.recordId, update.fields)
		if (result.ok) updated++
		else if (result.reason === "row_gone") rowGone++
		else {
			failed++
			console.error(`  ${update.phase}  ${update.title} (${update.recordId}) failed: ${result.reason}`)
		}
	}
	console.log(`updated: ${updated}, row gone: ${rowGone}, failed: ${failed}`)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
