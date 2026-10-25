import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { Pool } from "pg"
import { e2eDatabaseUrl } from "../e2e/env"

/**
 * Recreate the E2E database, replay migrations and seed it.
 *
 * The database name is already checked by `e2e/env.ts` (loopback, `*_e2e`), because this script drops whatever it names. Pointing it at the dev database is the one mistake that must be impossible.
 */

const root = resolve(import.meta.dirname, "..")

function run(args: string[], env: NodeJS.ProcessEnv): void {
	const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" })
	if (result.error) throw result.error
	if (result.status !== 0) process.exit(result.status ?? 1)
}

/**
 * Week 1 must already be open for onboarding tests, and a fixed date in the past would stop being true as the calendar moves. Rebuilding the database is exactly when this can be reset.
 */
function programStartDate(): string {
	return new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function main(): Promise<void> {
	const url = new URL(e2eDatabaseUrl)
	const database = url.pathname.replace(/^\//, "")
	const adminUrl = new URL(url)
	adminUrl.pathname = "/postgres"

	console.log(`[e2e] recreating ${database} on ${url.host}`)
	const admin = new Pool({ connectionString: adminUrl.toString() })
	try {
		await admin.query(`drop database if exists "${database}" with (force)`)
		await admin.query(`create database "${database}"`)
	} finally {
		await admin.end()
	}

	const startDate = programStartDate()
	const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl, PROGRAM_START_DATE: startDate }

	console.log(`[e2e] applying migrations (program start ${startDate})`)
	run(["x", "prisma", "db", "migrate", "--db", e2eDatabaseUrl], env)

	console.log("[e2e] seeding")
	run(["--conditions=react-server", "prisma/seed.ts"], env)

	console.log("[e2e] database ready")
}

try {
	await main()
} catch (err) {
	console.error("[e2e]", err)
	process.exit(1)
}
