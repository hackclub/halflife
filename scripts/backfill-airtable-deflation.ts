import {
	type AirtableConfig,
	AirtableListSchema,
	airtableFetch,
	getAirtableConfig,
	withRateLimitRetry,
} from "../src/lib/airtable/client"
import { deflationFor, deflationJustification, numberCell } from "../src/lib/airtable/deflation"
import { columnExists } from "../src/lib/airtable/field-probe"
import { fieldKey, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { recordIdsFromSyncEvents } from "../src/lib/airtable/sync"
import { updateYswsRecord } from "../src/lib/airtable/ysws"
import { defaultFeedback } from "../src/lib/ari"
import { AuditAction, Phase, PhaseStatus, type ReviewResult } from "../src/lib/enums"
import db from "../src/lib/prisma8"

/**
 * Fill `Optional - Override Hours Spent` and `Justification - Deflation Justification` on rows whose review approved fewer hours than the row claims.
 *
 * The live mirror writes both columns from the decision itself (see `syncReviewDecisionToYsws` in lib/airtable/sync). Rows decided before it did have neither, and the payout pipeline therefore still pays the self-reported figure even though a reviewer cut it. This replays what Postgres holds onto those rows.
 *
 * The claimed figure is the row's own `Hours spent (self reported)`, because that is the number the override replaces. The approved figure is the phase's frozen hours on ThemeProject (`designApprovedHours`/`approvedHours`), falling back to the standing review's frozen value for a decision old enough to predate the project column. A row with neither is reported as unknown rather than guessed at.
 *
 * Only approved rows are touched. A row that is back in review, returned or rejected is left alone: nothing here can say whether the hours it holds were meant to stay, and the live mirror clears them when that decision is made.
 *
 * Read-only unless `--commit` is passed. Run with `bun --conditions=react-server scripts/backfill-airtable-deflation.ts [--commit]`. In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")

interface StandingReview {
	feedback: string
	frozenApprovedHours: number | null
	hoursOverride: number | null
	result: ReviewResult
	reviewerId: string | null
}

interface CurrentRow {
	deflationJustification: string
	overrideHoursSpent: number | null
	selfReportedHours: number | null
}

interface Target {
	fields: { [_: string]: unknown }
	phase: Phase
	recordId: string
	title: string
}

/** The two columns and the claim they are compared against, read once for the whole table. */
async function currentRows(
	config: AirtableConfig,
	keys: { justification: string; override: string; selfReported: string },
): Promise<Map<string, CurrentRow>> {
	const qs = [keys.justification, keys.override, keys.selfReported]
		.map(key => `fields%5B%5D=${encodeURIComponent(key)}`)
		.join("&")
	const byId = new Map<string, CurrentRow>()
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsDeflation", () =>
			airtableFetch(
				AirtableListSchema,
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&${qs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const record of page.records) {
			const justification = record.fields[keys.justification]
			byId.set(record.id, {
				deflationJustification: typeof justification === "string" ? justification : "",
				overrideHoursSpent: numberCell(record.fields[keys.override]),
				selfReportedHours: numberCell(record.fields[keys.selfReported]),
			})
		}
		;({ offset } = page)
	} while (offset)
	return byId
}

/**
 * The note the justification should quote, or null when the review left none.
 *
 * Ari's generic fallback is stored as the project's review comment when the reviewer wrote nothing. It is not a reason, and the live mirror deliberately keeps it out of the row, so it is recognised here the same way `noteFor` in the review backfill does.
 */
function reasonFor(comments: string | null, review: StandingReview | undefined): string | null {
	const note = comments?.trim() ?? ""
	if (!note) return null
	if (review?.reviewerId === null && note === defaultFeedback(review.result)) return null
	return note
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const { deflationJustification: justificationField, hoursSelfReported, overrideHoursSpent } = YSWS_SUBMISSION.fields
	for (const field of [justificationField, overrideHoursSpent])
		if (!(await columnExists(config, YSWS_SUBMISSION.tableId, field.name))) {
			console.error(
				`The \`${field.name}\` column is not on ${YSWS_SUBMISSION.tableId}; create it in Airtable before backfilling.`,
			)
			process.exit(1)
		}

	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.select(
			"approvedHours",
			"buildReviewComments",
			"buildStatus",
			"designApprovedHours",
			"designReviewComments",
			"designStatus",
			"id",
			"title",
		)
		.all()
	if (projects.length === 0) {
		console.log("No projects; nothing to backfill.")
		return
	}

	const events = await db.orm.public.AuditLog.where({ action: AuditAction.AIRTABLE_SYNC_SUCCESS })
		.where(entry => entry.targetId.in(projects.map(p => p.id)))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const records = recordIdsFromSyncEvents(events)

	// Newest first, so the first review seen for a phase is the decision that stands.
	const reviews = await db.orm.public.SubmissionReview.where({ invalidated: false })
		.where(review => review.submission.some(submission => submission.themeProjectId.in(projects.map(p => p.id))))
		.orderBy(review => review.createdAt.desc())
		.select("feedback", "frozenApprovedHours", "hoursOverride", "result", "reviewerId")
		.include("submission", submission => submission.select("phase", "themeProjectId"))
		.all()
	const standing = new Map<string, StandingReview>()
	for (const review of reviews) {
		const { submission } = review
		if (!submission) continue
		const key = `${submission.themeProjectId}:${submission.phase}`
		if (!standing.has(key)) standing.set(key, review)
	}

	const keys = {
		justification: fieldKey(justificationField),
		override: fieldKey(overrideHoursSpent),
		selfReported: fieldKey(hoursSelfReported),
	}
	const current = await currentRows(config, keys)

	const updates: Target[] = []
	let withoutRow = 0
	let notApproved = 0
	let unknown = 0
	let noDeflation = 0
	let aligned = 0
	let gone = 0
	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const recordId = records.get(`${project.id}:${phase}`)
			if (!recordId) {
				withoutRow++
				continue
			}
			const design = phase === Phase.DESIGN
			const status = design ? project.designStatus : project.buildStatus
			if (status !== PhaseStatus.approved) {
				notApproved++
				continue
			}
			const review = standing.get(`${project.id}:${phase}`)
			const approved =
				(design ? project.designApprovedHours : project.approvedHours)
				?? review?.frozenApprovedHours
				?? review?.hoursOverride
				?? null
			if (approved === null) {
				unknown++
				continue
			}
			const row = current.get(recordId)
			if (!row) {
				gone++
				continue
			}
			const deflation = deflationFor(approved, row.selfReportedHours)
			if (!deflation) {
				noDeflation++
				continue
			}
			const fields = {
				[keys.justification]: deflationJustification(
					deflation,
					reasonFor(design ? project.designReviewComments : project.buildReviewComments, review),
				),
				[keys.override]: deflation.approvedHours,
			}
			if (
				row.overrideHoursSpent === deflation.approvedHours
				&& row.deflationJustification === fields[keys.justification]
			) {
				aligned++
				continue
			}
			updates.push({ fields, phase, recordId, title: project.title })
		}

	console.log(
		`Projects: ${projects.length}; Airtable rows: ${projects.length * 2} (${withoutRow} phase(s) never written, ${gone} row(s) since deleted)`,
	)
	console.log(
		`deflated: ${aligned + updates.length} (already correct: ${aligned}, to fill: ${updates.length}); not approved: ${notApproved}, approved with no frozen hours: ${unknown}, approved with nothing cut: ${noDeflation}`,
	)
	for (const target of updates.slice(0, 10))
		console.log(
			`  ${target.phase}  ${target.title}  →  ${JSON.stringify(target.fields[keys.override])}  /  ${JSON.stringify(target.fields[keys.justification])}`,
		)
	if (updates.length > 10) console.log(`  …and ${updates.length - 10} more`)

	if (!commit) {
		console.log("Dry run. Pass --commit to write the deflation columns on these rows.")
		return
	}

	let updated = 0
	let rowGone = 0
	let failed = 0
	for (const target of updates) {
		const written = await updateYswsRecord(target.recordId, target.fields)
		if (written.ok) updated++
		else if (written.reason === "row_gone") rowGone++
		else {
			failed++
			console.error(`  ${target.phase}  ${target.title} (${target.recordId}) failed: ${written.reason}`)
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
