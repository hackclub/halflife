import "dotenv/config"
import { AuditAction, Phase } from "../src/app/generated/prisma/enums"
import { type AirtableRecord, airtableFetch, getAirtableConfig, withRateLimitRetry } from "../src/lib/airtable/client"
import { columnExists } from "../src/lib/airtable/field-probe"
import { type JustificationValues, justificationValues, timelapseLinks } from "../src/lib/airtable/justification"
import { fieldKey, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { recordIdsFromSyncEvents } from "../src/lib/airtable/sync"
import { updateYswsRecord } from "../src/lib/airtable/ysws"
import prisma from "../src/lib/prisma"
import { getProgramSettings } from "../src/lib/program"

/**
 * Fill the `Justification - …` columns on the submission rows that are missing them.
 *
 * Four columns carry a submission's evidence: the maker's Hackatime id, the Hackatime projects they tracked time in, the timelapses they recorded, and the account of what they actually built. The pipeline merges them into one blob on the row (`Automation - Unified Justification`), so a column left empty is a gap in the justification a grant reviewer reads.
 *
 * Two of the four are routinely empty on the rows already in the base. `Justification - Specific Technical Features` was never written at all – the column exists and nothing in Half Life filled it – so the pipeline's merged blob has an empty `[SPECIFIC TECHNICAL FEATURES]` section on every row. `Justification - Lapse Links, comma-separated` is empty on the rows whose timelapses were attached after the row was written, and on the rows whose maker never recorded one.
 *
 * This replays the state Postgres already holds onto the rows that are missing a column, using the same builder the live write uses (see `justificationValues` in lib/airtable/justification), so a backfilled cell and a freshly written one cannot disagree.
 *
 * Only a column the base is missing is written. A column that already holds something is left exactly as it is: it is evidence, and on the pre-season rows the form filled it in and Postgres never received it, so overwriting it with our own answer would destroy the only record. A row is therefore never rewritten wholesale, only completed.
 *
 * The record id is not kept on the project. It is on the audit row each successful write left (`AIRTABLE_SYNC_SUCCESS`, the same source `lastRecordId` reads), so each (project, phase) is written at its newest id that has not since been `removed`; a row taken back on unsubmit is reported as gone rather than quietly recreated. A row in the base that Half Life never wrote or imported has no project behind it and nothing to fill it from – the report says how many those are, and the warm-up import on /admin/program is what turns them into local projects.
 *
 * Read-only unless `--commit` is passed. Run with
 * `bun --conditions=react-server scripts/backfill-airtable-justification.ts [--commit]`.
 * In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")

/** The columns this backfill fills, by the key `justificationValues` returns each one under. */
const COLUMNS = {
	hackatimeId: YSWS_SUBMISSION.fields.hackatimeId,
	hackatimeProjects: YSWS_SUBMISSION.fields.hackatimeProjects,
	lapseLinks: YSWS_SUBMISSION.fields.lapseLinks,
	specificTechnicalFeatures: YSWS_SUBMISSION.fields.specificTechnicalFeatures,
}

/** A string cell, or "" when Airtable has nothing there. */
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/** Every row's current justification columns, by record id. */
async function currentColumns(
	config: NonNullable<ReturnType<typeof getAirtableConfig>>,
	keys: Map<string, string>,
): Promise<Map<string, Map<string, string>>> {
	const byId = new Map<string, Map<string, string>>()
	const fieldsQs = [...keys.values()].map(k => `fields%5B%5D=${encodeURIComponent(k)}`).join("&")
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsJustification", () =>
			airtableFetch<{ records: AirtableRecord[]; offset?: string }>(
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const record of page.records) {
			const row = new Map<string, string>()
			for (const [key, field] of keys) row.set(key, text(record.fields[field]))
			byId.set(record.id, row)
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

	const projects = await prisma.themeProject.findMany({
		select: {
			bomItems: { select: { name: true, purpose: true, quantity: true } },
			description: true,
			hackatimeLinks: { select: { hackatimeProject: true, phase: true } },
			id: true,
			theme: true,
			title: true,
			user: { select: { hackatimeUserId: true } },
			workSessions: {
				orderBy: { createdAt: "asc" },
				select: {
					content: true,
					createdAt: true,
					effectiveDate: true,
					hoursClaimed: true,
					phase: true,
					timelapses: { select: { externalId: true, objectKey: true, playbackUrl: true, provider: true } },
					title: true,
				},
				where: { deletedAt: null },
			},
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
	const settings = await getProgramSettings()

	const targets: { phase: Phase; recordId: string; title: string; values: JustificationValues }[] = []
	let withoutRow = 0
	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const recordId = records.get(`${project.id}:${phase}`)
			if (!recordId) {
				withoutRow++
				continue
			}
			const sessions = project.workSessions.filter(s => s.phase === phase)
			const values = justificationValues(
				{
					bomItems: project.bomItems,
					description: project.description,
					hackatimeProjects: project.hackatimeLinks.filter(l => l.phase === phase).map(l => l.hackatimeProject),
					hackatimeUserId: project.user.hackatimeUserId,
					lapseLinks: timelapseLinks(sessions.flatMap(s => s.timelapses)),
					workSessions: sessions,
				},
				{ eventStart: settings.eventStartDate, phase, theme: project.theme },
			)
			targets.push({ phase, recordId, title: project.title, values })
		}

	// Only the cells the base is missing are written: a cell that already holds something is left as it is.
	const current = await currentColumns(config, keys)
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
		for (const [key, value] of Object.entries(target.values) as [string, string | undefined][]) {
			if (value === undefined) continue
			if (row.get(key)) continue
			fields[keys.get(key) ?? key] = value
			missing.set(key, (missing.get(key) ?? 0) + 1)
		}
		if (Object.keys(fields).length === 0) {
			aligned++
			continue
		}
		updates.push({ fields, phase: target.phase, recordId: target.recordId, title: target.title })
	}

	console.log(
		`Projects: ${projects.length}; Airtable rows in the base: ${current.size}; rows with a project behind them: ${targets.length} (${withoutRow} phase(s) never written, ${gone} row(s) since deleted)`,
	)
	console.log(`aligned: ${aligned}, to update: ${updates.length}`)
	for (const [key, field] of Object.entries(COLUMNS))
		console.log(`  ${field.name}: ${missing.get(key) ?? 0} cell(s) to fill`)
	const unreachable = current.size - targets.length
	if (unreachable > 0)
		console.log(
			`${unreachable} row(s) in the base have no project behind them; the warm-up import on /admin/program is what gives them one`,
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
	await prisma.$disconnect()
}
