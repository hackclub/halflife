import "dotenv/config"
import { AuditAction, Phase } from "../src/app/generated/prisma/enums"
import { getAirtableConfig } from "../src/lib/airtable/client"
import { columnExists } from "../src/lib/airtable/field-probe"
import { fieldKey, YSWS_SUBMISSION } from "../src/lib/airtable/schema"
import { updateYswsRecord } from "../src/lib/airtable/ysws"
import prisma from "../src/lib/prisma"

/**
 * Tick the `Starter project` checkbox on the Airtable rows written before the column existed.
 *
 * Half Life reads the flag off `starterProjectId` at write time (see `fieldsFor` in lib/airtable/sync), so every submission handled from now on carries it – but the rows already in the base do not. Airtable leaves a new checkbox unticked, so only the starter rows are wrong, and only those are patched here: a handful of writes rather than one per submission.
 *
 * The record id is not kept on the project. It is on the audit row each successful write left (`AIRTABLE_SYNC_SUCCESS`, the same source `lastRecordId` in lib/airtable/sync reads), so each (project, phase) is ticked at its newest id that has not since been `removed` – a row taken back on unsubmit is reported as gone rather than quietly recreated.
 *
 * Read-only unless `--commit` is passed. Run with
 * `bun --conditions=react-server scripts/backfill-airtable-starters.ts [--commit]`.
 * In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")

/** The newest record id per `<projectId>:<phase>` that has not since been removed. */
function latestRecordIds(events: { targetId: string | null; metadata: unknown }[]): Map<string, string> {
	const byPhase = new Map<string, string>()
	const settled = new Set<string>()
	for (const row of events) {
		const meta = row.metadata as { phase?: string; recordId?: string; removed?: boolean } | null
		if (!row.targetId || !meta?.phase) continue
		const key = `${row.targetId}:${meta.phase}`
		// The rows arrive newest first, so the first one seen for a phase is the one that stands.
		if (settled.has(key)) continue
		settled.add(key)
		if (!meta.removed && typeof meta.recordId === "string") byPhase.set(key, meta.recordId)
	}
	return byPhase
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const field = YSWS_SUBMISSION.fields.starterProject
	if (!(await columnExists(config, YSWS_SUBMISSION.tableId, field.name))) {
		console.error(
			`The \`${field.name}\` column is not on ${YSWS_SUBMISSION.tableId}; create it in Airtable before backfilling.`,
		)
		process.exit(1)
	}

	const projects = await prisma.themeProject.findMany({
		where: { starterProjectId: { not: null } },
		select: { id: true, title: true },
	})
	if (projects.length === 0) {
		console.log("No starter projects; nothing to backfill.")
		return
	}

	const events = await prisma.auditLog.findMany({
		where: { action: AuditAction.AIRTABLE_SYNC_SUCCESS, targetId: { in: projects.map((p) => p.id) } },
		orderBy: { createdAt: "desc" },
		select: { targetId: true, metadata: true },
	})
	const records = latestRecordIds(events)

	const targets: { title: string; phase: Phase; recordId: string }[] = []
	let withoutRow = 0
	for (const project of projects) {
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const recordId = records.get(`${project.id}:${phase}`)
			if (recordId) targets.push({ title: project.title, phase, recordId })
			else withoutRow++
		}
	}

	console.log(
		`Starter projects: ${projects.length}; Airtable rows to tick: ${targets.length} (${withoutRow} phase(s) never written)`,
	)
	for (const t of targets.slice(0, 10)) console.log(`  ${t.phase}  ${t.title}  →  ${t.recordId}`)
	if (targets.length > 10) console.log(`  …and ${targets.length - 10} more`)

	if (!commit) {
		console.log("Dry run. Pass --commit to tick the checkbox on these rows.")
		return
	}

	const key = fieldKey(field)
	let updated = 0
	let gone = 0
	let failed = 0
	for (const t of targets) {
		const result = await updateYswsRecord(t.recordId, { [key]: true })
		if (result.ok) updated++
		else if (result.reason === "row_gone") gone++
		else {
			failed++
			console.error(`  ${t.phase}  ${t.title} (${t.recordId}) failed: ${result.reason}`)
		}
	}
	console.log(`updated: ${updated}, row gone: ${gone}, failed: ${failed}`)
}

main()
	.catch((err) => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
