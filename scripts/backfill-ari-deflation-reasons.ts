import "../src/lib/auth"
import { AirtableListSchema, airtableFetch, getAirtableConfig, withRateLimitRetry } from "../src/lib/airtable/client"
import { fieldKey, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { recordIdsFromSyncEvents } from "../src/lib/airtable/sync"
import { AuditAction, ReviewResult } from "../src/lib/enums"
import db from "../src/lib/prisma8"

/**
 * Fill `SubmissionReview.deflationReason` for Ari approvals decided before the column existed.
 *
 * Ari's `review.justification.deflation_reason` used to be written only to the row's `Justification - Deflation Justification` column, so the review screen had nothing to show. That column is `deflationJustification` in lib/airtable/deflation: a "Deflated from … removed)." summary, then the reason. The summary is stripped and the rest is kept, unless it is exactly the review's audit note – that is the fallback the column uses when Ari sent no deflation reason, and it is already on the review as `reason`.
 *
 * Only standing Ari approvals (no Half Life reviewer) with no reason yet are touched, so re-running is safe.
 *
 * Read-only unless `--commit` is passed. Run with `bun --conditions=react-server scripts/backfill-ari-deflation-reasons.ts [--commit]`. In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")

const SUMMARY = /^Deflated from .*? removed\)\.\s*/s

async function justifications(): Promise<Map<string, string>> {
	const config = getAirtableConfig()
	if (!config) throw new Error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
	const key = fieldKey(YSWS_SUBMISSION.fields.deflationJustification)
	const byId = new Map<string, string>()
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsDeflationReasons", () =>
			airtableFetch(
				AirtableListSchema,
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&fields%5B%5D=${encodeURIComponent(key)}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const record of page.records) {
			const text = record.fields[key]
			if (typeof text === "string" && text.trim()) byId.set(record.id, text)
		}
		;({ offset } = page)
	} while (offset)
	return byId
}

async function main() {
	const reviews = await db.orm.public.SubmissionReview.where({
		deflationReason: null,
		invalidated: false,
		result: ReviewResult.APPROVED,
		reviewerId: null,
	})
		.where(review => review.submission.some(submission => submission.ariSubmissionId.isNotNull()))
		.select("id", "reason")
		.include("submission", submission => submission.select("phase", "themeProjectId"))
		.all()
	const projectIds = [
		...new Set(reviews.flatMap(review => (review.submission ? [review.submission.themeProjectId] : []))),
	]
	if (projectIds.length === 0) {
		console.log("No Ari approvals without a deflation reason; nothing to backfill.")
		return
	}

	const events = await db.orm.public.AuditLog.where({ action: AuditAction.AIRTABLE_SYNC_SUCCESS })
		.where(entry => entry.targetId.in(projectIds))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const records = recordIdsFromSyncEvents(events)
	const cells = await justifications()

	const updates: { id: string; reason: string }[] = []
	let withoutRow = 0
	let notDeflated = 0
	let auditNoteOnly = 0
	for (const review of reviews) {
		if (!review.submission) continue
		const recordId = records.get(`${review.submission.themeProjectId}:${review.submission.phase}`)
		if (!recordId) {
			withoutRow++
			continue
		}
		const cell = cells.get(recordId)
		if (!cell || !SUMMARY.test(cell)) {
			notDeflated++
			continue
		}
		const reason = cell.replace(SUMMARY, "").trim()
		if (!reason || reason === review.reason?.trim()) {
			auditNoteOnly++
			continue
		}
		updates.push({ id: review.id, reason })
	}

	console.log(
		`Ari approvals without a reason: ${reviews.length}; to fill: ${updates.length}; no row: ${withoutRow}; not deflated: ${notDeflated}; summary or audit note only: ${auditNoteOnly}`,
	)
	for (const update of updates.slice(0, 10)) console.log(`  ${update.id}  →  ${JSON.stringify(update.reason)}`)
	if (updates.length > 10) console.log(`  …and ${updates.length - 10} more`)

	if (!commit) {
		console.log("Dry run. Pass --commit to write these reasons.")
		return
	}
	for (const update of updates)
		await db.orm.public.SubmissionReview.where({ id: update.id }).update({ deflationReason: update.reason })
	console.log(`updated: ${updates.length}`)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
