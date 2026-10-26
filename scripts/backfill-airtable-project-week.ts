import { AirtableListSchema, airtableFetch, getAirtableConfig, withRateLimitRetry } from "../src/lib/airtable/client"
import { columnExists } from "../src/lib/airtable/field-probe"
import { fieldKey, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { projectWeekLabel, recordIdsFromSyncEvents } from "../src/lib/airtable/sync"
import { updateYswsRecord } from "../src/lib/airtable/ysws"
import { scheduledWeekFor } from "../src/lib/config/program"
import { AuditAction, Phase } from "../src/lib/enums"
import db from "../src/lib/prisma8"

/**
 * Fill `Loops - halfLifeProjectWeek` on the submission rows written before the column was synced.
 *
 * A row is created at hand-in, and `syncSubmissionToYsws` (lib/airtable/sync) now stamps the week's single-select label (`Week 1` … `Week 10`) on every write – first submissions, re-submissions and admin refreshes alike, since all of them go through `fieldsFor`. Rows already in the base carry nothing, and this replays the state Postgres already holds onto them: the theme and phase's own scheduled week, which is what every other week-derived column on the row already says.
 *
 * The record id is not kept on the project. It is on the audit row each successful write left (`AIRTABLE_SYNC_SUCCESS`, the same source `lastRecordId` reads), so each (project, phase) is written at its newest id that has not since been `removed`; a row taken back on unsubmit is reported as gone rather than quietly recreated. Warm-up submissions have no scheduled week and no matching option, so they are skipped rather than stamped with a label the base would refuse. Rows whose columns already agree are left alone, so a second run writes nothing.
 *
 * Read-only unless `--commit` is passed. Run with `bun --conditions=react-server scripts/backfill-airtable-project-week.ts [--commit]`. In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")

/** A string cell, or "" when Airtable has nothing there. */
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** Every row's current week label, by record id. */
async function currentColumns(
	config: NonNullable<ReturnType<typeof getAirtableConfig>>,
	weekKey: string,
): Promise<Map<string, string>> {
	const byId = new Map<string, string>()
	const fieldsQs = `fields%5B%5D=${encodeURIComponent(weekKey)}`
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsProjectWeek", () =>
			airtableFetch(
				AirtableListSchema,
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const r of page.records) byId.set(r.id, text(r.fields[weekKey]))
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

	const weekField = YSWS_SUBMISSION.fields.projectWeek
	// Probed by name, because `columnExists` reads Airtable's `UNKNOWN_FIELD_NAME` refusal; written by `fieldKey`, which is the id once the base is written by id.
	if (!(await columnExists(config, YSWS_SUBMISSION.tableId, weekField.name))) {
		console.error(
			`The \`${weekField.name}\` column is not on ${YSWS_SUBMISSION.tableId}; create it in Airtable before backfilling.`,
		)
		process.exit(1)
	}
	const weekKey = fieldKey(weekField)

	const projects = await db.orm.public.ThemeProject.select("id", "theme", "title").all()
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

	const targets: { phase: Phase; recordId: string; title: string; week: string }[] = []
	let withoutRow = 0
	let warmup = 0
	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const recordId = records.get(`${project.id}:${phase}`)
			if (!recordId) {
				withoutRow++
				continue
			}
			// The same week every other column on the row already says: the theme and phase's own scheduled week. A warm-up has none and no matching option, so it is skipped, not stamped.
			const label = projectWeekLabel(scheduledWeekFor(project.theme, phase))
			if (!label) {
				warmup++
				continue
			}
			targets.push({ phase, recordId, title: project.title, week: label })
		}

	// Only rows the base disagrees with are written: a row that already carries its week is left untouched.
	const current = await currentColumns(config, weekKey)
	const updates: typeof targets = []
	let aligned = 0
	let gone = 0
	for (const t of targets) {
		const have = current.get(t.recordId)
		if (have === undefined) {
			gone++
			continue
		}
		if (have === t.week) {
			aligned++
			continue
		}
		updates.push(t)
	}

	console.log(
		`Projects: ${projects.length}; Airtable rows: ${targets.length} (${withoutRow} phase(s) never written, ${gone} row(s) since deleted, ${warmup} warm-up phase(s) skipped)`,
	)
	console.log(`aligned: ${aligned}, to update: ${updates.length}`)
	for (const t of updates.slice(0, 10)) console.log(`  ${t.phase}  ${t.title}  →  ${t.week}`)
	if (updates.length > 10) console.log(`  …and ${updates.length - 10} more`)

	if (!commit) {
		console.log("Dry run. Pass --commit to write the project week on these rows.")
		return
	}

	let updated = 0
	let rowGone = 0
	let failed = 0
	for (const t of updates) {
		const result = await updateYswsRecord(t.recordId, { [weekKey]: t.week })
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
