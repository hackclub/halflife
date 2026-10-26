/**
 * TEMPORARY diagnostic for the Prisma 8 production cutover. Prints every
 * public native enum's member order exactly as PostgreSQL stores it, so
 * prisma/contract.prisma can be rewritten to match and `db sign` can pass.
 *
 * Delete after the first green production deploy.
 */
import { Pool } from "pg"

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error("DATABASE_URL is not set")

const pool = new Pool({ connectionString })
const { rows } = await pool.query<{ members: string; name: string }>(
	`SELECT t.typname AS name, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS members
	 FROM pg_type t
	 JOIN pg_enum e ON e.enumtypid = t.oid
	 JOIN pg_namespace n ON n.oid = t.typnamespace
	 WHERE n.nspname = 'public'
	 GROUP BY t.typname
	 ORDER BY t.typname`,
)
for (const row of rows) console.log(`${row.name}: ${row.members}`)
await pool.end()
