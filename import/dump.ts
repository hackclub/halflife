import { config } from "dotenv"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@/app/generated/prisma/client"

config({ path: "import/.env" })

const url = process.env.DB_URL
if (!url) throw new Error("DB_URL missing from import/.env")
const source = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

const TABLES = process.argv.slice(2)
if (TABLES.length === 0) throw new Error("usage: tsx import/dump.ts <table> [table...]")

async function main() {
  for (const table of TABLES) {
    const columns = await source.$queryRawUnsafe<
      { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]
    >(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      table,
    )
    console.log(`\n=== ${table} (${columns.length} columns) ===`)
    for (const c of columns) {
      const def = c.column_default ? ` default=${c.column_default.replace(/\s+/g, " ").slice(0, 40)}` : ""
      console.log(`  ${c.column_name.padEnd(34)} ${c.data_type}${c.is_nullable === "NO" ? " NOT NULL" : ""}${def}`)
    }
    const rows = await source.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${table}" LIMIT 1`,
    )
    if (rows[0]) {
      const sample: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rows[0])) {
        sample[k] = v instanceof Date ? v.toISOString() : v
      }
      console.log(`  sample: ${JSON.stringify(sample).slice(0, 1200)}`)
    }
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => source.$disconnect())
