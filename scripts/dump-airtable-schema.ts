import "dotenv/config"

/**
 * Print the field ids for the configured Airtable base, ready to paste into lib/airtable/schema.ts.
 *
 * Writing by field id rather than field name is what keeps the integration working when an ops person renames a column. Until these ids are filled in, the writer falls back to names (AIRTABLE_USE_FIELD_IDS=false), which works but breaks silently on a rename.
 */
async function main() {
	const apiKey = process.env.AIRTABLE_API_KEY
	const baseId = process.env.AIRTABLE_BASE_ID
	if (!apiKey || !baseId) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	})
	if (!res.ok) {
		console.error(`Airtable meta API returned ${res.status}: ${await res.text()}`)
		process.exit(1)
	}

	const body = (await res.json()) as {
		tables: { id: string; name: string; fields: { id: string; name: string; type: string }[] }[]
	}

	for (const table of body.tables) {
		console.log(`\n# ${table.name}  (${table.id})`)
		for (const field of table.fields) {
			console.log(`  ${field.id}  ${field.type.padEnd(20)} ${field.name}`)
		}
	}
	console.log("\nPaste these ids into lib/airtable/schema.ts, then set AIRTABLE_USE_FIELD_IDS=true.")
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
