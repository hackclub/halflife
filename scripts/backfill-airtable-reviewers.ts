import "dotenv/config"
import { Phase, type ReviewResult } from "../src/app/generated/prisma/enums"
import { getAirtableConfig } from "../src/lib/airtable/client"
import { columnExists } from "../src/lib/airtable/field-probe"
import { currentReviewColumns } from "../src/lib/airtable/review-columns"
import { fieldKey, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { recordIdsFromSyncEvents, reviewStatusFor, reviewStatusForResult } from "../src/lib/airtable/sync"
import { updateYswsRecord } from "../src/lib/airtable/ysws"
import prisma from "../src/lib/prisma"

/**
 * Fill the `Pass 1 reviewer` column on submission rows written before the live sync did.
 *
 * Ari reviews in two passes: a reviewer decides, then an organizer confirms. Half Life only hears about the decision once it is final, but the payload names the person who made it as `review.reviewer.email`, and every decision has stored that address on its review (`SubmissionReview.reviewerEmail`) since the column landed. This replays the standing decision's address onto each row.
 *
 * Only that pass can be filled. Ari never sends the confirming organizer: a second-pass confirmation re-sends the decision under the first-pass reviewer's identity, and the organizer exists only in Ari's internal activity log, which no API here reaches.
 *
 * The address is only written when the phase's current state agrees with the standing review's result. A phase back in review, reversed by an admin, or reopened from a rejection has no review that still accounts for its status, so its column is cleared rather than left naming someone whose decision no longer stands. A standing review that predates the address column offers nothing to write, so the row is left alone rather than cleared – `reviews:backfill-identities` is what fills that review first.
 *
 * Read-only unless `--commit` is passed. Run with
 * `bun --conditions=react-server scripts/backfill-airtable-reviewers.ts [--commit]`.
 * Run it where `DATABASE_URL` points at the real database, not from a dev machine against a local one.
 */

const commit = process.argv.includes("--commit")

interface StandingReview {
	result: ReviewResult
	reviewerEmail: string | null
}

interface Target {
	phase: Phase
	recordId: string
	/** An address to write, "" to clear, or null when the review that stands has no address to offer. */
	reviewerEmail: string | null
	title: string
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const pass1Field = YSWS_SUBMISSION.fields.pass1Reviewer
	if (!(await columnExists(config, YSWS_SUBMISSION.tableId, pass1Field.name))) {
		console.error(`Create the \`${pass1Field.name}\` single-line text field on ${YSWS_SUBMISSION.tableId} first.`)
		process.exit(1)
	}

	const projects = await prisma.themeProject.findMany({
		select: { buildStatus: true, designStatus: true, id: true, title: true },
	})
	if (projects.length === 0) {
		console.log("No themed projects; nothing to backfill.")
		return
	}

	const events = await prisma.auditLog.findMany({
		orderBy: { createdAt: "desc" },
		select: { metadata: true, targetId: true },
		where: { action: "AIRTABLE_SYNC_SUCCESS", targetId: { in: projects.map(p => p.id) } },
	})
	const records = recordIdsFromSyncEvents(events)

	// Newest first, so the first review seen for a phase is the decision that stands.
	const reviews = await prisma.submissionReview.findMany({
		orderBy: { createdAt: "desc" },
		select: {
			result: true,
			reviewerEmail: true,
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
		if (!standing.has(key)) standing.set(key, review)
	}

	const targets: Target[] = []
	let withoutRow = 0
	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const recordId = records.get(`${project.id}:${phase}`)
			if (!recordId) {
				withoutRow++
				continue
			}
			const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
			const review = standing.get(`${project.id}:${phase}`)
			// A review only names the row's reviewer while its result is the decision the row's status describes. A review old enough to have no address leaves whatever the column holds alone, rather than clearing what a person may have filled.
			const reviewerEmail =
				review && reviewStatusForResult(review.result) === reviewStatusFor(status)
					? review.reviewerEmail?.trim() || null
					: ""
			targets.push({ phase, recordId, reviewerEmail, title: project.title })
		}

	const current = await currentReviewColumns(config)
	const updates: (Target & { reviewerEmail: string })[] = []
	let aligned = 0
	let gone = 0
	let unknown = 0
	for (const target of targets) {
		const row = current.get(target.recordId)
		if (!row) {
			gone++
			continue
		}
		if (target.reviewerEmail === null) {
			unknown++
			continue
		}
		if (row.pass1Reviewer === target.reviewerEmail) {
			aligned++
			continue
		}
		updates.push({ ...target, reviewerEmail: target.reviewerEmail })
	}

	console.log(
		`Projects: ${projects.length}; Airtable rows: ${targets.length} (${withoutRow} phase(s) never written, ${gone} row(s) since deleted)`,
	)
	console.log(`aligned: ${aligned}, to fill: ${updates.length}, left alone (no address stored): ${unknown}`)
	for (const target of updates.slice(0, 10))
		console.log(`  ${target.phase}  ${target.title}  →  ${JSON.stringify(target.reviewerEmail)}`)
	if (updates.length > 10) console.log(`  …and ${updates.length - 10} more`)

	if (!commit) {
		console.log("Dry run. Pass --commit to write the Pass 1 reviewer column on these rows.")
		return
	}

	const reviewerKey = fieldKey(pass1Field)
	let updated = 0
	let rowGone = 0
	let failed = 0
	for (const target of updates) {
		const written = await updateYswsRecord(target.recordId, { [reviewerKey]: target.reviewerEmail })
		if (written.ok) updated++
		else if (written.reason === "row_gone") rowGone++
		else {
			failed++
			console.error(`  ${target.phase}  ${target.title} (${target.recordId}) failed: ${written.reason}`)
		}
	}
	console.log(`updated: ${updated}, row gone: ${rowGone}, failed: ${failed}`)
}

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
