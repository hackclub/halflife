import "../src/lib/auth"
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
 * Matching a row to its project (lib/airtable/ysws, findExistingRow) now tries this column first. A row without it can only be matched by the old email, title and stage key, which a second project can share. This stamps every row Half Life knows the record id of, using the project id it was written for.
 *
 * The record id is not kept on the project. It is on the audit row each successful write left (`AIRTABLE_SYNC_SUCCESS`, the same source `lastRecordId` reads), so each (project, phase) is written at its newest id that has not since been `removed`. A row taken back on unsubmit is reported as gone rather than recreated. Rows whose column already holds the project id are left alone, so a second run writes nothing.
 *
 * Read-only unless `--commit` is passed. Run with `bun --conditions=react-server scripts/backfill-airtable-half-life-id.ts [--commit]`. In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")

/** A string cell, or "" when Airtable has nothing there. */
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** Every row's current project id cell, by record id. */
async function currentColumns(
	config: NonNullable<ReturnType<typeof getAirtableConfig>>,
	idKey: string,
): Promise<Map<string, string>> {
	const byId = new Map<string, string>()
	const fieldsQs = `fields%5B%5D=${encodeURIComponent(idKey)}`
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsHalfLifeId", () =>
			airtableFetch(
				AirtableListSchema,
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const r of page.records) byId.set(r.id, text(r.fields[idKey]))
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

	const idField = YSWS_SUBMISSION.fields.halfLifeProjectId
	// Probed by name, because `columnExists` reads Airtable's `UNKNOWN_FIELD_NAME` refusal.
	if (!(await columnExists(config, YSWS_SUBMISSION.tableId, idField.name))) {
		console.error(
			`The \`${idField.name}\` column is not on ${YSWS_SUBMISSION.tableId}; create it in Airtable before backfilling.`,
		)
		process.exit(1)
	}
	const idKey = fieldKey(idField)

	const projects = await db.orm.public.ThemeProject.select("id", "title").all()
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

	const targets: { phase: Phase; projectId: string; recordId: string; title: string }[] = []
	let withoutRow = 0
	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const recordId = records.get(`${project.id}:${phase}`)
			if (!recordId) {
				withoutRow++
				continue
			}
			targets.push({ phase, projectId: project.id, recordId, title: project.title })
		}

	// Only rows the base disagrees with are written.
	const current = await currentColumns(config, idKey)
	const updates: typeof targets = []
	let aligned = 0
	let gone = 0
	for (const t of targets) {
		const have = current.get(t.recordId)
		if (have === undefined) {
			gone++
			continue
		}
		if (have === t.projectId) {
			aligned++
			continue
		}
		updates.push(t)
	}

	console.log(
		`Projects: ${projects.length}; Airtable rows: ${targets.length} (${withoutRow} phase(s) never written, ${gone} row(s) since deleted)`,
	)
	console.log(`aligned: ${aligned}, to update: ${updates.length}`)
	for (const t of updates.slice(0, 10)) console.log(`  ${t.phase}  ${t.title}  (${t.projectId})`)
	if (updates.length > 10) console.log(`  …and ${updates.length - 10} more`)

	if (!commit) {
		console.log("Dry run. Pass --commit to write the project id on these rows.")
		return
	}

	let updated = 0
	let rowGone = 0
	let failed = 0
	for (const t of updates) {
		const result = await updateYswsRecord(t.recordId, { [idKey]: t.projectId })
		if (result.ok) updated++
		else if (result.reason === "row_gone") rowGone++
		else {
			failed++
			console.error(`  ${t.phase}  ${t.title} (${t.recordId}) failed: ${result.reason}`)
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
