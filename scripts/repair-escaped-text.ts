import { Client } from "pg"
import { sanitize } from "../src/lib/sanitize"

/**
 * Undo the HTML escaping `sanitize` used to store in plain-text fields.
 *
 * Until `sanitize` returned the fragment's text, it returned DOMPurify's serialised HTML, so a maker's "<3" was stored as "&lt;3" and "PCB Design & Fabrication" as "PCB Design &amp; Fabrication" – and every reader shows these fields as text, so the entities showed on the page, in Airtable, and (escaped once more) in Slack. Running a stored value through today's `sanitize` decodes it exactly: the markup was already stripped when it was written, so all that changes is the entities.
 *
 * The columns are the plain-text ones `sanitize` writes, plus journal bodies (`work_session.content`). Those are Markdown that used to be stored through a `sanitizeHtml` with the same escaping, and are now stored as typed. They are not run back through `sanitize`, which would strip Markdown that looks like a tag (`Vec<u8>`); they get the exact inverse of what DOMPurify's serialiser does to text instead (see `unescapeText`). Markup the old sanitiser removed outright is gone either way.
 *
 * Read-only unless `--commit` is passed. Run with `bun --conditions=react-server scripts/repair-escaped-text.ts [--commit]` against the database in `DATABASE_URL`.
 */

const COLUMNS: { [table: string]: readonly string[] } = Object.freeze({
	bom_item: ["name", "purpose", "vendor"],
	ledger_entry: ["note"],
	phase_submission: ["notes"],
	post: ["caption", "hiddenReason"],
	post_comment: ["body", "hiddenReason"],
	review_dispute: ["note"],
	review_dispute_message: ["body"],
	rsvp_buffer: ["firstName", "lastName", "pronouns", "referredBy", "signupPage", "utmSource"],
	shop_item: ["name", "description"],
	shop_order: ["holdReason", "rejectionReason", "trackingCarrier", "trackingNumber"],
	shop_order_note: ["body"],
	submission_review: ["feedback", "reason", "technicalFeatures"],
	theme_project: ["title", "description"],
	work_session: ["title", "reviewComments"],
})

/** What DOMPurify's serialiser produces for text: the three it must escape, and a no-break space. */
const ESCAPED = "&(amp|lt|gt|nbsp);"

/**
 * The inverse of DOMPurify's escaping of text: `<`, `>` and the no-break space, then `&` last, so text that was escaped once is unescaped once (`&amp;lt;` comes back as `&lt;`, not `<`).
 */
const unescapeText = (value: string): string =>
	value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&nbsp;", "\u00A0").replaceAll("&amp;", "&")

/** Journal bodies: Markdown, decoded rather than sanitised. */
const DECODED: { [table: string]: readonly string[] } = Object.freeze({ work_session: ["content"] })

const commit = process.argv.includes("--commit")
const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set")
const client = new Client({ connectionString: url })
await client.connect()

const existing = await client.query<{ column_name: string; table_name: string }>(
	`select table_name, column_name from information_schema.columns
	 where table_schema = 'public' and data_type in ('text', 'character varying')`,
)
const present = new Set(existing.rows.map(row => `${row.table_name}.${row.column_name}`))

const passes = [
	...Object.entries(COLUMNS).map(([table, columns]) => ({ columns, repair: sanitize, table })),
	...Object.entries(DECODED).map(([table, columns]) => ({ columns, repair: unescapeText, table })),
]

let changed = 0
for (const { columns, repair, table } of passes)
	for (const column of columns) {
		if (!present.has(`${table}.${column}`)) continue
		// Identifiers from the list above, checked against the schema, so quoting them is enough.
		const rows = await client.query<{ id: string; value: string }>(
			`select "id", "${column}" as value from "${table}" where "${column}" ~ $1`,
			[ESCAPED],
		)
		for (const row of rows.rows) {
			const fixed = repair(row.value)
			if (fixed === row.value) continue
			changed++
			// Around the first escape, so a long journal entry shows what changes rather than how it opens.
			const at = Math.max(0, row.value.search(/&(amp|lt|gt|nbsp);/) - 30)
			console.log(
				`${table}.${column} ${row.id}: ${JSON.stringify(row.value.slice(at, at + 80))} → ${JSON.stringify(fixed.slice(at, at + 70))}`,
			)
			if (commit) await client.query(`update "${table}" set "${column}" = $1 where "id" = $2`, [fixed, row.id])
		}
	}

console.log(
	`${changed} value${changed === 1 ? "" : "s"} ${commit ? "repaired" : "to repair (dry run; pass --commit to write)"}`,
)
await client.end()
