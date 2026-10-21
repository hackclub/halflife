import "dotenv/config"
import { airtableFetch, getAirtableConfig, withRateLimitRetry } from "../src/lib/airtable/client"
import { existingColumns } from "../src/lib/airtable/field-probe"
import { LOOPS_REVIEW_OVERRIDE, YSWS_SUBMISSION } from "../src/lib/airtable/schema"

/**
 * Fill the two `Loops - Override - …` columns with each row's own project and
 * week before the email-tools poller starts forwarding them.
 *
 * Creating those fields makes the poller treat every row as newly changed. If
 * they were left blank, the override strategy would send a blank project name
 * and week to every contact on the first full resync. Filling them here keeps
 * the value the row already carries, so the resync changes nothing visible and
 * a later decision is the first write that moves the contact.
 *
 * The columns have to exist first, as plain single-line text fields on
 * `YSWS Project Submission`:
 *
 *   Loops - Override - halfLifeProjectName
 *   Loops - Override - halfLifeProjectWeek
 *
 * Pause the email-tools Airtable source while you create them. The first poll
 * after a new `Loops - …` field appears does a full resync, and an override
 * that is still blank on that pass would write a blank project name to every
 * contact. Fill them here, then resume the source.
 *
 * Read-only unless `--commit` is passed. Run with
 * `bun --conditions=react-server scripts/backfill-loops-review-overrides.ts [--commit]`.
 */

const commit = process.argv.includes("--commit")
const BATCH = 10

interface Row {
	fields: { [_: string]: unknown }
	id: string
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first.")
		process.exit(1)
	}

	const writable = await existingColumns(config, YSWS_SUBMISSION.tableId, Object.values(LOOPS_REVIEW_OVERRIDE))
	const missing = Object.values(LOOPS_REVIEW_OVERRIDE).filter(field => !writable.has(field))
	if (missing.length > 0) {
		console.error(
			`Create these single-line text fields on ${YSWS_SUBMISSION.tableId} first:\n  ${missing.join("\n  ")}`,
		)
		process.exit(1)
	}

	const sourceName = YSWS_SUBMISSION.fields.projectName.name
	const sourceWeek = YSWS_SUBMISSION.fields.projectWeek.name
	const readFields = [sourceName, sourceWeek, ...Object.values(LOOPS_REVIEW_OVERRIDE)]
	const fieldsQs = readFields.map(field => `fields%5B%5D=${encodeURIComponent(field)}`).join("&")

	const rows: Row[] = []
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsOverrides", () =>
			airtableFetch<{ offset?: string; records: Row[] }>(
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		rows.push(...page.records)
		offset = page.offset
	} while (offset)

	const updates: { fields: { [_: string]: unknown }; id: string }[] = []
	for (const row of rows) {
		const name = row.fields[sourceName]
		if (typeof name !== "string" || !name.trim()) continue
		const week = row.fields[sourceWeek]
		const nameOverride = row.fields[LOOPS_REVIEW_OVERRIDE.projectName]
		const weekOverride = row.fields[LOOPS_REVIEW_OVERRIDE.projectWeek]

		const fields: { [_: string]: unknown } = {}
		if (nameOverride !== name) fields[LOOPS_REVIEW_OVERRIDE.projectName] = name
		// A warm-up has no week; leave its override blank rather than inventing one.
		if (typeof week === "string" && week && weekOverride !== week) fields[LOOPS_REVIEW_OVERRIDE.projectWeek] = week
		if (Object.keys(fields).length > 0) updates.push({ fields, id: row.id })
	}

	console.log(`Rows: ${rows.length}; override cells to fill: ${updates.length}`)
	for (const update of updates.slice(0, 10)) console.log(`  ${update.id}  ${JSON.stringify(update.fields)}`)
	if (updates.length > 10) console.log(`  …and ${updates.length - 10} more`)

	if (!commit) {
		console.log("Dry run. Pass --commit to write the override cells.")
		return
	}

	let written = 0
	for (let i = 0; i < updates.length; i += BATCH) {
		const batch = updates.slice(i, i + BATCH)
		await withRateLimitRetry("updateYswsOverrides", () =>
			airtableFetch(config, encodeURIComponent(YSWS_SUBMISSION.tableId), {
				body: JSON.stringify({ records: batch, typecast: false }),
				method: "PATCH",
			}),
		)
		written += batch.length
	}
	console.log(`updated: ${written}`)
}

main().catch(err => {
	console.error(err)
	process.exitCode = 1
})
