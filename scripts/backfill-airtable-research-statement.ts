import "../src/lib/auth"
import { AirtableListSchema, airtableFetch, getAirtableConfig, withRateLimitRetry } from "../src/lib/airtable/client"
import { columnExists } from "../src/lib/airtable/field-probe"
import { RESEARCH_TIME_STATEMENT, withResearchStatement } from "../src/lib/airtable/research-statement"
import { fieldKey, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { recordIdsFromSyncEvents } from "../src/lib/airtable/sync"
import { updateYswsRecord } from "../src/lib/airtable/ysws"
import { AuditAction, Phase } from "../src/lib/enums"
import db from "../src/lib/prisma8"

/**
 * Add the research-time statement to `Justification - Additional Justification` on the submission rows written before it was added.
 *
 * Every write of that column now carries the statement ahead of the project link (see `additionalJustificationCell` in lib/airtable/justification), but rows already in the base hold only the reviewer's "Justification notes", the link, or nothing. This places the statement before the link, or at the end when there is no link, so a note is kept as it is. A row that already carries the statement is left alone, so a second run writes nothing.
 *
 * It can run before or after `backfill-airtable-project-link.ts`: the project link backfill keeps any statement already in the cell, and this one puts the statement ahead of a link that is already there.
 *
 * The record id is not kept on the project. It is on the audit row each successful write left (`AIRTABLE_SYNC_SUCCESS`, the same source `lastRecordId` reads), so each (project, phase) is written at its newest id that has not since been `removed`; a row taken back on unsubmit is reported as gone rather than quietly recreated.
 *
 * Read-only unless `--commit` is passed. Run with `bun --conditions=react-server scripts/backfill-airtable-research-statement.ts [--commit]`. In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")

/** A string cell, or "" when Airtable has nothing there. */
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** Every row's current `Additional Justification` cell, by record id. */
async function currentCells(
	config: NonNullable<ReturnType<typeof getAirtableConfig>>,
	fieldName: string,
): Promise<Map<string, string>> {
	const byId = new Map<string, string>()
	const fieldsQs = `fields%5B%5D=${encodeURIComponent(fieldName)}`
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsResearchStatement", () =>
			airtableFetch(
				AirtableListSchema,
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const r of page.records)
			byId.set(r.id, text(r.fields[fieldName] ?? r.fields[YSWS_SUBMISSION.fields.additionalJustification.id]))
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

	const field = YSWS_SUBMISSION.fields.additionalJustification
	// Probed by name, because `columnExists` reads Airtable's `UNKNOWN_FIELD_NAME` refusal; written by `fieldKey`, which is the id once the base is written by id.
	if (!(await columnExists(config, YSWS_SUBMISSION.tableId, field.name))) {
		console.error(
			`The \`${field.name}\` column is not on ${YSWS_SUBMISSION.tableId}; create it in Airtable before backfilling.`,
		)
		process.exit(1)
	}
	const key = fieldKey(field)

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

	const targets: { phase: Phase; recordId: string; title: string }[] = []
	let withoutRow = 0
	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const recordId = records.get(`${project.id}:${phase}`)
			if (!recordId) {
				withoutRow++
				continue
			}
			targets.push({ phase, recordId, title: project.title })
		}

	// Only rows that lack the statement are written; a cell that already has it is left untouched.
	const current = await currentCells(config, field.name)
	const updates: { cell: string; phase: Phase; recordId: string; title: string }[] = []
	let aligned = 0
	let gone = 0
	for (const target of targets) {
		const have = current.get(target.recordId)
		if (have === undefined) {
			gone++
			continue
		}
		if (have.includes(RESEARCH_TIME_STATEMENT)) {
			aligned++
			continue
		}
		updates.push({
			cell: withResearchStatement(have),
			phase: target.phase,
			recordId: target.recordId,
			title: target.title,
		})
	}

	console.log(
		`Projects: ${projects.length}; Airtable rows: ${targets.length} (${withoutRow} phase(s) never written, ${gone} row(s) since deleted)`,
	)
	console.log(`aligned: ${aligned}, to update: ${updates.length}`)
	for (const update of updates.slice(0, 10)) console.log(`  ${update.phase}  ${update.title}`)
	if (updates.length > 10) console.log(`  …and ${updates.length - 10} more`)

	if (!commit) {
		console.log("Dry run. Pass --commit to add the statement to these rows.")
		return
	}

	let updated = 0
	let rowGone = 0
	let failed = 0
	for (const update of updates) {
		const result = await updateYswsRecord(update.recordId, { [key]: update.cell })
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
