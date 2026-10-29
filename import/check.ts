import { SQL } from "bun"
import { bunSqlUrl } from "@/lib/db-url"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL missing")
const db = new SQL(bunSqlUrl(databaseUrl))

async function q(label: string, sql: string) {
	const rows = await db.unsafe<{ [_: string]: unknown }[]>(sql)
	console.log(`\n${label}`)
	for (const r of rows)
		console.log(`  ${JSON.stringify(r, (_k, v: unknown) => (typeof v === "bigint" ? Number(v) : v))}`)
}

async function main() {
	await q(
		"counts",
		`SELECT
       (SELECT count(*) FROM "user") AS users,
       (SELECT count(*) FROM "user" WHERE email LIKE 'imported+%@halflife.test') AS imported_users,
       (SELECT count(*) FROM theme_project) AS projects,
       (SELECT count(*) FROM work_session) AS sessions,
       (SELECT count(*) FROM session_media) AS media,
       (SELECT count(*) FROM session_timelapse) AS timelapses,
       (SELECT count(*) FROM bom_item) AS bom_items,
       (SELECT count(*) FROM hackatime_link) AS hackatime_links,
       (SELECT count(*) FROM phase_submission) AS submissions,
       (SELECT count(*) FROM submission_review) AS reviews,
       (SELECT count(*) FROM ledger_entry) AS ledger,
       (SELECT count(*) FROM shop_item) AS shop_items,
       (SELECT count(*) FROM shop_order) AS shop_orders`,
	)

	await q(
		"orphaned foreign keys (all must be 0)",
		`SELECT
       (SELECT count(*) FROM theme_project p LEFT JOIN "user" u ON u.id = p."userId" WHERE u.id IS NULL) AS projects_no_user,
       (SELECT count(*) FROM work_session s LEFT JOIN theme_project p ON p.id = s."themeProjectId" WHERE p.id IS NULL) AS sessions_no_project,
       (SELECT count(*) FROM session_media m LEFT JOIN work_session s ON s.id = m."workSessionId" WHERE s.id IS NULL) AS media_no_session,
       (SELECT count(*) FROM submission_review r LEFT JOIN phase_submission s ON s.id = r."submissionId" WHERE s.id IS NULL) AS reviews_no_submission,
       (SELECT count(*) FROM submission_review r LEFT JOIN "user" u ON u.id = r."reviewerId" WHERE r."reviewerId" IS NOT NULL AND u.id IS NULL) AS reviews_no_reviewer,
       (SELECT count(*) FROM ledger_entry l LEFT JOIN "user" u ON u.id = l."userId" WHERE u.id IS NULL) AS ledger_no_user,
       (SELECT count(*) FROM shop_order o LEFT JOIN "user" u ON u.id = o."userId" WHERE u.id IS NULL) AS orders_no_user,
       (SELECT count(*) FROM shop_order o LEFT JOIN shop_item i ON i.id = o."shopItemId" WHERE i.id IS NULL) AS orders_no_item`,
	)

	await q(
		"theme uniqueness violations (must be 0)",
		`SELECT count(*)::int AS dupes FROM (
       SELECT "userId", theme FROM theme_project GROUP BY 1, 2 HAVING count(*) > 1
     ) t`,
	)

	await q(
		"a sample of imported projects",
		`SELECT p.title, p.theme, p."designStatus", p."buildStatus",
            count(DISTINCT s.id)::int AS sessions, count(DISTINCT b.id)::int AS bom
     FROM theme_project p
     LEFT JOIN work_session s ON s."themeProjectId" = p.id
     LEFT JOIN bom_item b ON b."themeProjectId" = p.id
     WHERE p."userId" IN (SELECT id FROM "user" WHERE email LIKE 'imported+%@halflife.test')
     GROUP BY p.id
     ORDER BY sessions DESC
     LIMIT 5`,
	)

	await q(
		"richest imported maker",
		`SELECT u.name, count(DISTINCT p.id)::int AS projects, count(s.id)::int AS sessions,
            count(DISTINCT r.id)::int AS reviews_written
     FROM "user" u
     LEFT JOIN theme_project p ON p."userId" = u.id
     LEFT JOIN work_session s ON s."themeProjectId" = p.id
     LEFT JOIN submission_review r ON r."reviewerId" = u.id
     WHERE u.email LIKE 'imported+%@halflife.test'
     GROUP BY u.id ORDER BY sessions DESC LIMIT 3`,
	)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
