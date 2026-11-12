import "../src/lib/auth"
import {
	type AirtableConfig,
	AirtableListSchema,
	type AirtableRecord,
	airtableFetch,
	getAirtableConfig,
	withRateLimitRetry,
} from "../src/lib/airtable/client"
import { existingColumns } from "../src/lib/airtable/field-probe"
import { drainedRecordRows, LOOPS_FIELDS, listSignupRecords, resolveSignupRow } from "../src/lib/airtable/loops"
import { fieldKey, RSVP_TABLE_ID, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { recordIdsFromSyncEvents } from "../src/lib/airtable/sync"
import { deleteUnifiedRecords, deleteYswsRecord } from "../src/lib/airtable/ysws"
import { logAudit } from "../src/lib/audit"
import { scheduledWeekFor } from "../src/lib/config/program"
import { AuditAction, Phase } from "../src/lib/enums"
import db from "../src/lib/prisma8"

/**
 * Reconcile the two week surfaces that can drift apart: the rows in `YSWS Project Submission`, and the `Loops - halfLifeWeek{n}ProjectSubmitted` checkboxes on `Signups`.
 *
 * They are written from different places. A row is created at hand-in and removed only on unsubmit; the boxes are recomputed from live submissions. That leaves two classes of drift:
 *
 * 1. **Ghost rows** – a project that was deleted after a rejected or returned hand-in keeps its Airtable row, because project deletion is a soft delete and does not remove the reviewer-facing row. The maker's box clears (the project is no longer live), but the row stays. The same happens to a live project whose phase has no submission but whose row was never removed. This script finds those rows, and with `--commit` deletes them and logs a `removed` audit entry so `lastRecordId` knows the row is gone.
 *
 * 2. **Stale or missing ticks** – the box should be true exactly when a live project has a hand-in for that scheduled week. The hourly `loops-sync` already converges this, but a manual run is useful after a cleanup and reports both directions. With `--commit` it PATCHes only the rows that disagree.
 *
 * Missing rows (a live submission with no row) are reported, not created: the retry endpoint owns in-review submissions, and recreating a decided row can re-trigger the Loops email that already went out. Orphan rows (a row with no matching audit entry, usually written before Half Life recorded ids) are also reported, never deleted automatically.
 *
 * The join is the same one the Loops sync uses: `Half-Life User ID`, then the drained record id, then email. A submitter with no Signups row is reported separately – the box cannot be written without one.
 *
 * Read-only unless `--commit` is passed. Run with `bun --conditions=react-server scripts/reconcile-airtable-weeks.ts [--commit]`. In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")
const WEEKS = Array.from({ length: 10 }, (_, i) => i + 1)

interface GhostRow {
	deleted: boolean
	email: string
	phase: Phase
	projectId: string
	recordId: string
	title: string
	week: string
}

interface MissingRow {
	email: string
	/** True when an audit entry names a record id that the base no longer has; false when it was never written. */
	hadRecord: boolean
	phase: Phase
	projectId: string
	title: string
	week: string
}

/** A string cell, or "" when Airtable has nothing there. */
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** The `Week n` label for a scheduled week, or a marker that names why there is none. */
const weekLabel = (week: number): string => (week >= 1 && week <= 10 ? `Week ${week}` : "(no program week)")

/** The week number encoded in a `Loops - halfLifeWeek{n}ProjectSubmitted` column. */
const weekNumberOf = (column: string): number => Number(/Week(\d+)ProjectSubmitted/.exec(column)?.[1] ?? 0)

/** Every row of the YSWS table carrying the requested columns. */
async function listYswsRecords(config: AirtableConfig, fields: string[]): Promise<AirtableRecord[]> {
	const fieldsQs = fields.map(f => `fields%5B%5D=${encodeURIComponent(f)}`).join("&")
	const records: AirtableRecord[] = []
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsReconcile", () =>
			airtableFetch(
				AirtableListSchema,
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100${fieldsQs ? `&${fieldsQs}` : ""}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		records.push(...page.records)
		;({ offset } = page)
	} while (offset)
	return records
}

/** Every Signups row, indexed the way the Loops sync resolves one. */
function indexSignups(rows: AirtableRecord[]) {
	const byEmail = new Map<string, AirtableRecord>()
	const byUserId = new Map<string, AirtableRecord>()
	const allByUserId = new Map<string, AirtableRecord[]>()
	for (const row of rows) {
		const email = row.fields[LOOPS_FIELDS.email]
		if (typeof email === "string" && !byEmail.has(email.trim().toLowerCase()))
			byEmail.set(email.trim().toLowerCase(), row)
		const userId = row.fields[LOOPS_FIELDS.userId]
		if (typeof userId !== "string") continue
		const key = userId.trim()
		if (!byUserId.has(key)) byUserId.set(key, row)
		const rowsForUser = allByUserId.get(key) ?? []
		rowsForUser.push(row)
		allByUserId.set(key, rowsForUser)
	}
	return { allByUserId, byEmail, byUserId }
}

/** Write tick corrections in Airtable's ten-record batches. */
async function writeTickUpdates(
	config: AirtableConfig,
	updates: Map<string, { [_: string]: boolean }>,
): Promise<{ failed: number; written: number }> {
	let failed = 0
	let written = 0
	const entries = [...updates]
	for (let i = 0; i < entries.length; i += 10) {
		const batch = entries.slice(i, i + 10)
		try {
			await withRateLimitRetry("reconcileSignupTicks", () =>
				airtableFetch(AirtableListSchema, config, encodeURIComponent(RSVP_TABLE_ID), {
					body: JSON.stringify({
						records: batch.map(([id, fields]) => ({ fields, id })),
						typecast: false,
					}),
					method: "PATCH",
				}),
			)
			written += batch.length
		} catch (err) {
			failed += batch.length
			console.error(`  batch failed: ${err instanceof Error ? err.message : String(err)}`)
		}
	}
	return { failed, written }
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const projects = await db.orm.public.ThemeProject.select("deletedAt", "id", "theme", "title", "userId")
		.include("submissions", submissions => submissions.select("phase", "scheduledWeek"))
		.all()
	if (projects.length === 0) {
		console.log("No themed projects; nothing to reconcile.")
		return
	}
	const users = await db.orm.public.User.select("email", "id").all()
	const emailByUserId = new Map(users.map(user => [user.id, user.email]))

	// ---- YSWS rows against Postgres -------------------------------------------------
	const yswsFields = [
		fieldKey(YSWS_SUBMISSION.fields.email),
		fieldKey(YSWS_SUBMISSION.fields.projectName),
		fieldKey(YSWS_SUBMISSION.fields.projectWeek),
		fieldKey(YSWS_SUBMISSION.fields.reviewStatus),
		fieldKey(YSWS_SUBMISSION.fields.stage),
	]
	const yswsRows = await listYswsRecords(config, yswsFields)
	const yswsById = new Map(yswsRows.map(row => [row.id, row]))

	const events = await db.orm.public.AuditLog.where({ action: AuditAction.AIRTABLE_SYNC_SUCCESS })
		.where(entry => entry.targetId.in(projects.map(project => project.id)))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const knownRecordIds = recordIdsFromSyncEvents(events)

	const expected = new Set<string>()
	const ghosts: GhostRow[] = []
	const missing: MissingRow[] = []
	for (const project of projects) {
		const submissions = project.submissions ?? []
		const email = emailByUserId.get(project.userId) ?? ""
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const recordId = knownRecordIds.get(`${project.id}:${phase}`)
			const submission = submissions.find(row => row.phase === phase)
			const week = submission?.scheduledWeek ?? scheduledWeekFor(project.theme, phase)
			const live = project.deletedAt === null
			if (live && submission) {
				if (recordId && yswsById.has(recordId)) expected.add(recordId)
				else
					missing.push({
						email,
						hadRecord: Boolean(recordId),
						phase,
						projectId: project.id,
						title: project.title,
						week: weekLabel(week),
					})
				continue
			}
			// A row that belongs to a deleted project, or to a phase with no live hand-in, is a ghost: nothing in the app will ever update or remove it.
			if (recordId && yswsById.has(recordId))
				ghosts.push({
					deleted: !live,
					email,
					phase,
					projectId: project.id,
					recordId,
					title: project.title,
					week: weekLabel(week),
				})
		}
	}

	const knownIds = new Set(knownRecordIds.values())
	const orphans = yswsRows.filter(row => !knownIds.has(row.id))

	console.log(`YSWS rows: ${yswsRows.length}`)
	console.log(`Expected live submission rows: ${expected.size}`)
	console.log(`Ghost rows: ${ghosts.length}`)
	console.log(`Missing rows: ${missing.length}`)
	console.log(`Orphan rows (no audit entry names them): ${orphans.length}`)

	if (ghosts.length > 0) {
		console.log("\nGhost rows:")
		for (const ghost of ghosts)
			console.log(
				`  ${ghost.week}  ${ghost.phase}  ${ghost.title || "(untitled)"}  ${ghost.email || "(no user email)"}  ${ghost.deleted ? "deleted project" : "no live hand-in"}  ${ghost.recordId}`,
			)
	}
	if (missing.length > 0) {
		console.log("\nMissing rows (reported, never created by this script):")
		for (const row of missing)
			console.log(
				`  ${row.week}  ${row.phase}  ${row.title || "(untitled)"}  ${row.email || "(no user email)"}  ${row.hadRecord ? "row gone from the base" : "never written"}`,
			)
	}
	if (orphans.length > 0) {
		console.log("\nOrphan rows (left alone):")
		for (const row of orphans.slice(0, 20)) {
			const week = text(row.fields[fieldKey(YSWS_SUBMISSION.fields.projectWeek)])
			const email = text(row.fields[fieldKey(YSWS_SUBMISSION.fields.email)])
			const title = text(row.fields[fieldKey(YSWS_SUBMISSION.fields.projectName)])
			console.log(`  ${week || "(blank week)"}  ${title || "(untitled)"}  ${email || "(no email)"}  ${row.id}`)
		}
		if (orphans.length > 20) console.log(`  …and ${orphans.length - 20} more`)
	}

	// ---- Signups ticks against live submissions -------------------------------------
	const tickFields = WEEKS.map(LOOPS_FIELDS.submitted)
	const writable = await existingColumns(config, RSVP_TABLE_ID, tickFields)
	const tickColumns = tickFields.filter(column => writable.has(column))
	if (tickColumns.length < tickFields.length)
		console.log(`\nOnly ${tickColumns.length}/10 submitted columns exist; reconciling those and skipping the rest.`)

	const signupRows = await listSignupRecords(config, [LOOPS_FIELDS.email, LOOPS_FIELDS.userId, ...tickColumns])
	const { allByUserId, byEmail, byUserId } = indexSignups(signupRows)
	const byRecordId = await drainedRecordRows()

	const weeksByUser = new Map<string, Set<number>>()
	for (const project of projects) {
		if (project.deletedAt !== null) continue
		const weeks = weeksByUser.get(project.userId) ?? new Set<number>()
		for (const submission of project.submissions ?? []) {
			const week = submission.scheduledWeek ?? scheduledWeekFor(project.theme, submission.phase)
			if (week >= 1 && week <= 10) weeks.add(week)
		}
		weeksByUser.set(project.userId, weeks)
	}

	const duplicateUserIds = [...allByUserId].filter(([, rows]) => rows.length > 1)
	const unmatchedSubmitters: string[] = []
	const updates = new Map<string, { [_: string]: boolean }>()
	let boxesCleared = 0
	let boxesSet = 0
	let matched = 0
	let placeholderRows = 0
	let unmatched = 0
	for (const user of users) {
		const hit = resolveSignupRow(user, { byEmail, byRecordId, byUserId })
		if (!hit) {
			unmatched++
			if ((weeksByUser.get(user.id)?.size ?? 0) > 0) unmatchedSubmitters.push(user.email)
			continue
		}
		matched++
		const want = weeksByUser.get(user.id) ?? new Set<number>()
		const current = hit.row.fields
		// A drained placeholder carries no fields to compare against, so its boxes are written blind. Checkbox writes are idempotent, and the hourly sync converges anything this overwrites.
		const placeholder = Object.keys(current).length === 0
		if (placeholder) placeholderRows++
		const fields: { [_: string]: boolean } = {}
		for (const column of tickColumns) {
			const week = weekNumberOf(column)
			const wantValue = want.has(week)
			const have = current[column] === true
			if (placeholder || have !== wantValue) fields[column] = wantValue
			if (!placeholder && have !== wantValue)
				if (have) boxesCleared++
				else boxesSet++
		}
		if (Object.keys(fields).length > 0) updates.set(hit.row.id, { ...updates.get(hit.row.id), ...fields })
	}

	console.log("\nSignups tick reconciliation:")
	console.log(`  users checked: ${users.length}`)
	console.log(`  matched to a Signups row: ${matched}`)
	console.log(`  unmatched (no Signups row): ${unmatched}`)
	console.log(`  rows the join cannot see: ${placeholderRows} (will be written blind)`)
	console.log(`  boxes to clear (ticked, no live submission): ${boxesCleared}`)
	console.log(`  boxes to set (live submission, not ticked): ${boxesSet}`)
	console.log(`  rows to update: ${updates.size}`)

	if (unmatchedSubmitters.length > 0) {
		console.log("\nSubmitters with no Signups row (the box cannot be written):")
		for (const email of unmatchedSubmitters) console.log(`  ${email}`)
	}
	if (duplicateUserIds.length > 0) {
		console.log("\nUser ids with more than one Signups row (only the first is updated by the sync):")
		for (const [userId, rows] of duplicateUserIds)
			console.log(`  ${userId}: ${rows.map(row => text(row.fields[LOOPS_FIELDS.email])).join(" | ")}`)
	}

	if (!commit) {
		console.log("\nDry run. Pass --commit to delete ghost rows and write tick corrections.")
		return
	}

	let deleted = 0
	let deleteFailed = 0
	for (const ghost of ghosts)
		try {
			const local = await deleteYswsRecord(ghost.recordId)
			if (local.unifiedRecordId) {
				const unified = await deleteUnifiedRecords([local.unifiedRecordId])
				if (unified.error) console.error(`  unified twin ${local.unifiedRecordId} failed: ${unified.error}`)
			}
			if (local.deleted || local.skipped === "already_gone") {
				await logAudit({
					action: AuditAction.AIRTABLE_SYNC_SUCCESS,
					actorId: null,
					metadata: { phase: ghost.phase, reconciled: true, removed: true },
					targetId: ghost.projectId,
					targetType: "ThemeProject",
				})
				deleted++
			} else {
				deleteFailed++
				console.error(`  ${ghost.recordId} was not deleted: ${local.skipped ?? "unknown"}`)
			}
		} catch (err) {
			deleteFailed++
			console.error(`  ${ghost.recordId} failed: ${err instanceof Error ? err.message : String(err)}`)
		}

	const ticks = await writeTickUpdates(config, updates)
	console.log(
		`\nDeleted ${deleted}/${ghosts.length} ghost rows (${deleteFailed} failed). Updated ${ticks.written}/${updates.size} Signups rows (${ticks.failed} failed).`,
	)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
