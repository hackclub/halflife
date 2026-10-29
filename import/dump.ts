import { SQL } from "bun"
import { bunSqlUrl } from "@/lib/db-url"

const url = process.env.DB_URL
if (!url) throw new Error("DB_URL missing from import/.env")
const source = new SQL(bunSqlUrl(url))

const TABLES = process.argv.slice(2)
if (TABLES.length === 0) throw new Error("usage: bun --env-file=import/.env import/dump.ts <table> [table...]")

async function main() {
	for (const table of TABLES) {
		const columns = await source.unsafe<
			{
				column_name: string
				data_type: string
				is_nullable: string
				column_default: string | null
			}[]
		>(
			`SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
			[table],
		)
		console.log(`\n=== ${table} (${columns.length} columns) ===`)
		for (const c of columns) {
			const def = c.column_default ? ` default=${c.column_default.replaceAll(/\s+/g, " ").slice(0, 40)}` : ""
			console.log(`  ${c.column_name.padEnd(34)} ${c.data_type}${c.is_nullable === "NO" ? " NOT NULL" : ""}${def}`)
		}
		const rows = await source.unsafe<{ [_: string]: unknown }[]>(`SELECT * FROM "${table}" LIMIT 1`)
		if (rows[0]) {
			const sample: { [_: string]: unknown } = {}
			for (const [k, v] of Object.entries(rows[0])) sample[k] = v instanceof Date ? v.toISOString() : v

			console.log(`  sample: ${JSON.stringify(sample).slice(0, 1200)}`)
		}
	}
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await source.close()
}
