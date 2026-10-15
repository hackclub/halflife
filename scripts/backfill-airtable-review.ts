import "dotenv/config"
import { AuditAction, Phase, PhaseStatus, type ReviewResult } from "../src/app/generated/prisma/enums"
import { type AirtableRecord, airtableFetch, getAirtableConfig, withRateLimitRetry } from "../src/lib/airtable/client"
import { columnExists } from "../src/lib/airtable/field-probe"
import { fieldKey, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { recordIdsFromSyncEvents, reviewStatusFor } from "../src/lib/airtable/sync"
import { updateYswsRecord } from "../src/lib/airtable/ysws"
import { defaultFeedback } from "../src/lib/ari"
import prisma from "../src/lib/prisma"

/**
 * Fill `Loops - halfLifeReviewStatus` and `Loops - halfLifeReviewerNotes` on the submission rows written before the mirror existed.
 *
 * A row is created at hand-in, as "Pending Review", and a decision reaches the base only through `mirrorReviewDecision` (lib/airtable/sync): Ari's webhook or the review console writes the status and the reviewer's note onto the submission's row, and Loops emails the maker from there. Every row handled since that mirror landed carries both columns; the rows already in the base do not, and this replays the state Postgres already holds onto them.
 *
 * The status is `reviewStatusFor` of the phase – the same mapping every write uses, so the column cannot disagree with the state it mirrors. The note is the project's standing review comment (`designReviewComments`/`buildReviewComments`), which is the string the live mirror writes for a console decision and for a reversal alike. Two cases need more than the comment:
 *
 * - An Ari decision that carried no note is stored as Ari's generic fallback (`defaultFeedback`), because the review row and the project page always need something to show, but the raw note was never kept. The mirror deliberately writes an empty column rather than that fallback, so the standing decision is read too and the note cleared instead of quoting a sentence the maker already read as the headline.
 * - A phase still in review has no decision to quote, so its note is cleared whichever comment last touched the row.
 *
 * The record id is not kept on the project. It is on the audit row each successful write left (`AIRTABLE_SYNC_SUCCESS`, the same source `lastRecordId` reads), so each (project, phase) is written at its newest id that has not since been `removed`; a row taken back on unsubmit is reported as gone rather than quietly recreated. Rows whose columns already agree are left alone, so a second run writes nothing.
 *
 * Loops triggers off this column, so restoring a decided row can email the maker the same way a fresh decision does. Run this before the Loops workflow is switched on if nobody is to be told about a decision already made.
 *
 * Read-only unless `--commit` is passed. Run with
 * `bun --conditions=react-server scripts/backfill-airtable-review.ts [--commit]`.
 * In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")

/** The decision that still holds for a phase, as far as the note reconstruction needs it. */
type StandingReview = {
	feedback: string
	result: ReviewResult
	reviewerId: string | null
}

/** A string cell, or "" when Airtable has nothing there. */
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/**
 * The note the column should hold for a phase.
 *
 * `comments` is the project's standing review comment. `standing` is the decision that still holds, if any, which the comment alone cannot identify: an Ari decision with no note is stored as the generic fallback and must read as empty, and a phase in review has no decision to quote at all (see the header).
 */
function noteFor(comments: string | null, status: PhaseStatus, standing: StandingReview | undefined): string {
	if (status === PhaseStatus.in_review) return ""
	const note = comments?.trim() ?? ""
	if (!note) return ""
	if (standing?.reviewerId === null && note === defaultFeedback(standing.result)) return ""
	return note
}

/** Every row's current status and note, by record id. */
async function currentColumns(
	config: NonNullable<ReturnType<typeof getAirtableConfig>>,
	statusKey: string,
	notesKey: string,
): Promise<Map<string, { note: string; status: string }>> {
	const byId = new Map<string, { note: string; status: string }>()
	const fieldsQs = [statusKey, notesKey].map(k => `fields%5B%5D=${encodeURIComponent(k)}`).join("&")
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsReviewColumns", () =>
			airtableFetch<{ records: AirtableRecord[]; offset?: string }>(
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const r of page.records) byId.set(r.id, { note: text(r.fields[notesKey]), status: text(r.fields[statusKey]) })
		offset = page.offset
	} while (offset)
	return byId
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const statusField = YSWS_SUBMISSION.fields.reviewStatus
	const notesField = YSWS_SUBMISSION.fields.reviewerNotes
	// Probed by name, because `columnExists` reads Airtable's `UNKNOWN_FIELD_NAME` refusal; written by `fieldKey`, which is the id once the base is written by id.
	for (const field of [statusField, notesField]) {
		if (!(await columnExists(config, YSWS_SUBMISSION.tableId, field.name))) {
			console.error(
				`The \`${field.name}\` column is not on ${YSWS_SUBMISSION.tableId}; create it in Airtable before backfilling.`,
			)
			process.exit(1)
		}
	}
	const statusKey = fieldKey(statusField)
	const notesKey = fieldKey(notesField)

	const projects = await prisma.themeProject.findMany({
		select: {
			buildReviewComments: true,
			buildStatus: true,
			designReviewComments: true,
			designStatus: true,
			id: true,
			title: true,
		},
	})
	if (projects.length === 0) {
		console.log("No themed projects; nothing to backfill.")
		return
	}

	const events = await prisma.auditLog.findMany({
		orderBy: { createdAt: "desc" },
		select: { metadata: true, targetId: true },
		where: { action: AuditAction.AIRTABLE_SYNC_SUCCESS, targetId: { in: projects.map(p => p.id) } },
	})
	const records = recordIdsFromSyncEvents(events)

	// The decision that still holds per phase – the one case the comment alone cannot answer.
	const reviews = await prisma.submissionReview.findMany({
		orderBy: { createdAt: "desc" },
		select: {
			feedback: true,
			result: true,
			reviewerId: true,
			submission: { select: { phase: true, themeProjectId: true } },
		},
		where: {
			invalidated: false,
			submission: { themeProjectId: { in: projects.map(p => p.id) } },
		},
	})
	const standing = new Map<string, StandingReview>()
	for (const review of reviews) {
		const key = `${review.submission.themeProjectId}:${review.submission.phase}`
		// Newest first, so the first review seen for a phase is the decision that stands.
		if (!standing.has(key)) standing.set(key, review)
	}

	const targets: { note: string; phase: Phase; recordId: string; status: string; title: string }[] = []
	let withoutRow = 0
	for (const project of projects) {
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const recordId = records.get(`${project.id}:${phase}`)
			if (!recordId) {
				withoutRow++
				continue
			}
			const design = phase === Phase.DESIGN
			const status = design ? project.designStatus : project.buildStatus
			targets.push({
				note: noteFor(
					design ? project.designReviewComments : project.buildReviewComments,
					status,
					standing.get(`${project.id}:${phase}`),
				),
				phase,
				recordId,
				status: reviewStatusFor(status),
				title: project.title,
			})
		}
	}

	// Only rows the base disagrees with are written: a decided row that already carries both columns is left untouched.
	const current = await currentColumns(config, statusKey, notesKey)
	const updates: typeof targets = []
	let aligned = 0
	let gone = 0
	for (const t of targets) {
		const row = current.get(t.recordId)
		if (!row) {
			gone++
			continue
		}
		if (row.note === t.note && row.status === t.status) {
			aligned++
			continue
		}
		updates.push(t)
	}

	console.log(
		`Projects: ${projects.length}; Airtable rows: ${targets.length} (${withoutRow} phase(s) never written, ${gone} row(s) since deleted)`,
	)
	console.log(`aligned: ${aligned}, to update: ${updates.length}`)
	for (const t of updates.slice(0, 10))
		console.log(`  ${t.phase}  ${t.title}  →  ${t.status}  /  ${JSON.stringify(t.note)}`)
	if (updates.length > 10) console.log(`  …and ${updates.length - 10} more`)

	if (!commit) {
		console.log("Dry run. Pass --commit to write the review columns on these rows.")
		return
	}

	let updated = 0
	let noteFailed = 0
	let rowGone = 0
	let failed = 0
	for (const t of updates) {
		const moved = await updateYswsRecord(t.recordId, { [statusKey]: t.status })
		if (!moved.ok) {
			if (moved.reason === "row_gone") rowGone++
			else {
				failed++
				console.error(`  ${t.phase}  ${t.title} (${t.recordId}) failed: ${moved.reason}`)
			}
			continue
		}
		// A second request, like the live mirror: the status is the load-bearing column, and a notes value the base refuses must not cost it its update.
		const noted = await updateYswsRecord(t.recordId, { [notesKey]: t.note })
		if (!noted.ok && noted.reason !== "row_gone") {
			noteFailed++
			console.error(`  ${t.phase}  ${t.title} (${t.recordId}) moved but the note failed: ${noted.reason}`)
		}
		updated++
	}
	console.log(`updated: ${updated}, note failed: ${noteFailed}, row gone: ${rowGone}, failed: ${failed}`)
}

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
