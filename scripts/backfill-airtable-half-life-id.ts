import "../src/lib/auth"
import { writeFileSync } from "node:fs"
import { AirtableListSchema, airtableFetch, getAirtableConfig, withRateLimitRetry } from "../src/lib/airtable/client"
import { columnExists } from "../src/lib/airtable/field-probe"
import { fieldKey, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { recordIdsFromSyncEvents } from "../src/lib/airtable/sync"
import { updateYswsRecord } from "../src/lib/airtable/ysws"
import { AuditAction, Phase } from "../src/lib/enums"
import db from "../src/lib/prisma8"

/**
 * Fill `Half Life project ID` on the submission rows written before the column existed.
 *
 * Matching a row to its project (lib/airtable/ysws, findExistingRow) now tries this column first. A row without it can only be matched by the old email, title and stage key, which a second project can share, so this backfill stamps the column where the match is certain.
 *
 * Each (project, phase) that was submitted is placed on an Airtable row by one of two routes, in order:
 *
 * - `audit`: the record id the sync audit trail (`AIRTABLE_SYNC_SUCCESS`, the same source `lastRecordId` reads) recorded for it. This is the authoritative route.
 * - `exact`: the maker's email, the project's title and the stage match exactly one Airtable row, and exactly one project phase has that key. Titles can change after a submission, so a row that no longer matches its title stays unplaced here rather than guessed at.
 *
 * Everything else is listed for a person to decide and is never written: a key shared by several projects or several rows (`ambiguous`), a row with no project behind it (`no_project`), a project with no row (`no_row`), and a row already stamped with another project's id (`conflicting_id`).
 *
 * Dry run unless `--commit` is passed. It always writes the full report to `/tmp/opencode/half-life-id-report.json`. Run with `bun --conditions=react-server scripts/backfill-airtable-half-life-id.ts [--commit]`. In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")
const REPORT_PATH = "/tmp/opencode/half-life-id-report.json"
const PRINT_LIMIT = 20

type Route = "audit" | "exact"
type Skip = "ambiguous" | "no_project" | "no_row" | "conflicting_id"

interface Candidate {
	email: string
	key: string
	phase: Phase
	projectId: string
	title: string
}

interface AirtableRow {
	id: string
	key: string
	projectId: string
}

/** A string cell, or "" when Airtable has nothing there. */
const text = (value: unknown): string => (typeof value === "string" ? value : "")

const keyFor = (email: string, title: string, stage: string): string =>
	`${email.trim().toLowerCase()}|${title.trim()}|${stage}`

/** Every row in the table, reduced to the cells the match needs. */
async function listRows(
	config: NonNullable<ReturnType<typeof getAirtableConfig>>,
	keys: { email: string; idKey: string; projectName: string; stage: string },
): Promise<AirtableRow[]> {
	const rows: AirtableRow[] = []
	const fieldsQs = [keys.email, keys.idKey, keys.projectName, keys.stage]
		.map(k => `fields%5B%5D=${encodeURIComponent(k)}`)
		.join("&")
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsHalfLifeId", () =>
			airtableFetch(
				AirtableListSchema,
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const r of page.records)
			rows.push({
				id: r.id,
				key: keyFor(text(r.fields[keys.email]), text(r.fields[keys.projectName]), text(r.fields[keys.stage])),
				projectId: text(r.fields[keys.idKey]),
			})
		;({ offset } = page)
	} while (offset)
	return rows
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const idField = YSWS_SUBMISSION.fields.halfLifeProjectId
	// Probed by name, because `columnExists` reads Airtable's `UNKNOWN_FIELD_NAME` refusal.
	if (!(await columnExists(config, YSWS_SUBMISSION.tableId, idField.name))) {
		console.error(
			`The \`${idField.name}\` column is not on ${YSWS_SUBMISSION.tableId}; create it in Airtable before backfilling.`,
		)
		process.exit(1)
	}
	const idKey = fieldKey(idField)
	const emailKey = fieldKey(YSWS_SUBMISSION.fields.email)
	const projectNameKey = fieldKey(YSWS_SUBMISSION.fields.projectName)
	const stageKey = fieldKey(YSWS_SUBMISSION.fields.stage)

	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.select("id", "title")
		.include("user", user => user.select("email"))
		.all()
	if (projects.length === 0) {
		console.log("No themed projects; nothing to backfill.")
		return
	}
	const projectIds = projects.map(p => p.id)
	const submissions = await db.orm.public.PhaseSubmission.where(s => s.themeProjectId.in(projectIds))
		.select("phase", "themeProjectId")
		.all()

	const projectById = new Map(projects.map(p => [p.id, p]))
	const candidates: Candidate[] = []
	const seen = new Set<string>()
	for (const s of submissions) {
		const project = projectById.get(s.themeProjectId)
		if (!project?.user) continue
		const { phase } = s
		const id = `${project.id}:${phase}`
		if (seen.has(id)) continue
		seen.add(id)
		const stage = phase === Phase.DESIGN ? "Design" : "Build"
		candidates.push({
			email: project.user.email,
			key: keyFor(project.user.email, project.title, stage),
			phase,
			projectId: project.id,
			title: project.title,
		})
	}

	const events = await db.orm.public.AuditLog.where({ action: AuditAction.AIRTABLE_SYNC_SUCCESS })
		.where(entry => entry.targetId.in(projectIds))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const auditRecords = recordIdsFromSyncEvents(events)

	const rows = await listRows(config, { email: emailKey, idKey, projectName: projectNameKey, stage: stageKey })
	const rowById = new Map(rows.map(r => [r.id, r]))
	const rowsByKey = new Map<string, AirtableRow[]>()
	for (const r of rows) rowsByKey.set(r.key, [...(rowsByKey.get(r.key) ?? []), r])
	const candidatesByKey = new Map<string, Candidate[]>()
	for (const c of candidates) candidatesByKey.set(c.key, [...(candidatesByKey.get(c.key) ?? []), c])

	const writes: { route: Route; recordId: string; projectId: string; phase: Phase; title: string }[] = []
	const aligned: string[] = []
	const skipped: { reason: Skip; phase?: Phase; projectId?: string; title?: string; recordId?: string; key: string }[] =
		[]
	const placedRecords = new Set<string>()

	// Audit-trail placements first: they are authoritative.
	for (const c of candidates) {
		const recordId = auditRecords.get(`${c.projectId}:${c.phase}`)
		if (!recordId) continue
		const row = rowById.get(recordId)
		if (!row) continue
		placedRecords.add(recordId)
		if (row.projectId === c.projectId) aligned.push(recordId)
		else if (row.projectId === "")
			writes.push({ phase: c.phase, projectId: c.projectId, recordId, route: "audit", title: c.title })
		else
			skipped.push({
				key: c.key,
				phase: c.phase,
				projectId: c.projectId,
				reason: "conflicting_id",
				recordId,
				title: c.title,
			})
	}

	// Exact-key placements for everything the audit trail did not place.
	const placedProjectPhases = new Set(writes.map(w => `${w.projectId}:${w.phase}`))
	for (const c of candidates) {
		if (
			auditRecords.has(`${c.projectId}:${c.phase}`)
			&& rowById.has(auditRecords.get(`${c.projectId}:${c.phase}`) ?? "")
		)
			continue
		const sameKeyCandidates = candidatesByKey.get(c.key) ?? []
		const sameKeyRows = rowsByKey.get(c.key) ?? []
		if (sameKeyCandidates.length > 1 || sameKeyRows.length > 1) {
			skipped.push({ key: c.key, phase: c.phase, projectId: c.projectId, reason: "ambiguous", title: c.title })
			continue
		}
		if (sameKeyRows.length === 0) {
			skipped.push({ key: c.key, phase: c.phase, projectId: c.projectId, reason: "no_row", title: c.title })
			continue
		}
		const [row] = sameKeyRows
		if (!row) continue
		if (placedRecords.has(row.id) || placedProjectPhases.has(`${c.projectId}:${c.phase}`)) continue
		if (row.projectId === c.projectId) aligned.push(row.id)
		else if (row.projectId === "") {
			writes.push({ phase: c.phase, projectId: c.projectId, recordId: row.id, route: "exact", title: c.title })
			placedRecords.add(row.id)
		} else
			skipped.push({
				key: c.key,
				phase: c.phase,
				projectId: c.projectId,
				reason: "conflicting_id",
				recordId: row.id,
				title: c.title,
			})
	}

	// Rows with no project behind them at all.
	for (const r of rows) {
		if ((candidatesByKey.get(r.key) ?? []).length > 0) continue
		if (r.projectId !== "") continue
		skipped.push({ key: r.key, reason: "no_project", recordId: r.id })
	}

	const report = {
		counts: {
			aligned: aligned.length,
			candidates: candidates.length,
			rows: rows.length,
			skipped: skipped.length,
			writes: writes.length,
			writesByRoute: {
				audit: writes.filter(w => w.route === "audit").length,
				exact: writes.filter(w => w.route === "exact").length,
			},
		},
		generatedAt: new Date().toISOString(),
		skipped,
		writes,
	}
	writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)

	console.log(`Projects: ${projects.length}; submitted phases: ${candidates.length}; Airtable rows: ${rows.length}`)
	console.log(
		`to write: ${writes.length} (audit ${report.counts.writesByRoute.audit}, exact ${report.counts.writesByRoute.exact}); already aligned: ${aligned.length}; left for a person: ${skipped.length}`,
	)
	const byReason = new Map<Skip, number>()
	for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1)
	for (const [reason, n] of byReason) console.log(`  ${reason}: ${n}`)
	for (const w of writes.slice(0, PRINT_LIMIT))
		console.log(`  write ${w.route}  ${w.phase}  ${w.title}  (${w.projectId})`)
	if (writes.length > PRINT_LIMIT) console.log(`  …and ${writes.length - PRINT_LIMIT} more`)
	console.log(`Full report: ${REPORT_PATH}`)

	if (!commit) {
		console.log("Dry run. Pass --commit to write the project id on the rows listed under to write.")
		return
	}

	let updated = 0
	let rowGone = 0
	let failed = 0
	for (const w of writes) {
		const result = await updateYswsRecord(w.recordId, { [idKey]: w.projectId })
		if (result.ok) updated++
		else if (result.reason === "row_gone") rowGone++
		else {
			failed++
			console.error(`  ${w.phase}  ${w.title} (${w.recordId}) failed: ${result.reason}`)
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
