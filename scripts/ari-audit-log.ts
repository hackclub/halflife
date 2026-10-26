import { writeFile } from "node:fs/promises"
import { isRecord } from "../src/lib/unknown"

/**
 * Download a whole Ari program's audit log (the Activity page) using your logged-in cookie.
 *
 * Ari has no API for the audit log. The Activity page reads `db.activityEvent` in its `+page.server.ts` load, streams the result through a deferred promise, and the rows never reach the HTML. What the browser gets instead is the page's own data endpoint, `/p/<program>/activity/__data.json`, where the load's node carries a promise id and the rows arrive afterwards as a `text/sveltekit-data` chunk. That endpoint is what this reads, and it is the same query, filters and track scoping the page itself uses.
 *
 * `?all=1` lifts the page's 500-row cap. Without it the response holds only the latest 500 events while `total` still counts every one, which looks like a complete download. The response is devalue's flattened form (the format SvelteKit encodes load data with), so it is decoded here rather than parsed as plain JSON.
 *
 * The session cookie is what authenticates it, so this is a local operator tool rather than a job: sign in to ari.hackclub.com, copy the value of its `ari_session` cookie (DevTools → Application → Cookies, or the same-named value on any request), and put it in `ARI_COOKIE` (or `--cookie`). The account needs `VIEW_AUDIT_LOG` on the program, which is also what the page checks.
 *
 * Read-only: it fetches once and writes a file. Run with `bun run ari:audit-log`, or `bun scripts/ari-audit-log.ts --out=ari-audit.json` to pick the path. `--format=csv` and `--format=ndjson` are there for spreadsheets and streams; `--out=-` writes to stdout.
 *
 * Flags: `--program`, `--cookie`, `--out`, `--format` (json). Env: `ARI_PROGRAM`, `ARI_COOKIE`, `ARI_BASE`.
 */

const BASE = (process.env.ARI_BASE ?? "https://ari.hackclub.com").replace(/\/$/, "")
/** Half Life's program id, so a run against it needs no argument. */
const DEFAULT_PROGRAM = "cmtkgvs59016w01ny164gthi9"
/** Ari's session cookie (`sessionCookie` in `src/lib/server/auth.ts`). */
const COOKIE_NAME = "ari_session"

type Format = "csv" | "json" | "ndjson"

interface Options {
	cookie: string
	format: Format
	out: string
	program: string
}

/** One row as the Activity page renders it. Fields the page derives for display (icon, colours, "3 days ago") are left out of the download. */
interface AuditRow {
	action: string
	actorName: string
	actorSlackId: string | null
	detail: string
	details: { key: string; value: string }[]
	href: string | null
	id: string
	iso: string
	submissionId: string
	text: string
}

interface AuditLog {
	rows: unknown[]
	total: unknown
}

/** The value of a `--name=value` or `--name value` flag, or null when it is absent. */
function flagValue(args: string[], name: string): string | null {
	for (const [index, arg] of args.entries()) {
		if (arg === `--${name}`) return args[index + 1] ?? null
		if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3)
	}
	return null
}

/** The `ari_session` token from the input, tolerating a pasted `ari_session=…` pair or a whole Cookie header. */
function sessionToken(raw: string): string {
	let value = raw.trim().replace(/^"(.*)"$/, "$1")
	if (value.startsWith(`${COOKIE_NAME}=`)) value = value.slice(COOKIE_NAME.length + 1)
	// a cookie value cannot contain `;`, so anything after one is another cookie the caller pasted in.
	return value.split(";")[0]?.trim() ?? ""
}

function readFormat(raw: string): Format {
	if (raw === "json" || raw === "ndjson" || raw === "csv") return raw
	throw new Error(`--format must be json, ndjson or csv, got ${raw}`)
}

function readOptions(args: string[]): Options {
	const program = flagValue(args, "program") ?? process.env.ARI_PROGRAM ?? DEFAULT_PROGRAM
	const cookie = sessionToken(flagValue(args, "cookie") ?? process.env.ARI_COOKIE ?? "")
	const format = readFormat(flagValue(args, "format") ?? "json")
	const out = flagValue(args, "out") ?? `ari-audit-${program}.${format === "json" ? "json" : format}`

	if (!cookie) throw new Error("Set ARI_COOKIE (or --cookie) to the value of your ari_session cookie.")
	return { cookie, format, out, program }
}

/** devalue's flattened form: slot 0 is the root, a number is another slot, and negative numbers are specials. */
function unflatten(flat: unknown[]): unknown {
	const done: unknown[] = new Array(flat.length)

	const hydrate = (slot: unknown): unknown => {
		if (typeof slot !== "number") throw new Error(`Unexpected value in Ari's data: ${JSON.stringify(slot)}`)

		if (slot === -1 || slot === -2) return undefined // undefined, and a hole in an array
		if (slot === -3) return Number.NaN
		if (slot === -4) return Number.POSITIVE_INFINITY
		if (slot === -5) return Number.NEGATIVE_INFINITY
		if (slot === -6) return -0
		if (slot < 0) throw new Error(`Unsupported value in Ari's data: special index ${slot}`)

		if (slot in done) return done[slot]
		const value = flat[slot]
		if (Array.isArray(value)) {
			// a slot whose first entry is a string is a typed value (Date, Set, Map…), not a plain list of slots
			if (typeof value[0] === "string") throw new Error(`Unsupported value in Ari's data: ${value[0]}`)
			const list: unknown[] = []
			done[slot] = list
			for (const item of value) list.push(hydrate(item))
			return list
		}
		if (value !== null && typeof value === "object") {
			const record: { [_: string]: unknown } = {}
			done[slot] = record
			for (const [key, entry] of Object.entries(value)) record[key] = hydrate(entry)
			return record
		}
		done[slot] = value
		return value
	}

	return hydrate(0)
}

/** The decoded log from one `__data.json` body, or the error the page would have shown. */
function readPageData(body: string, program: string): AuditLog {
	let nodes: unknown = null
	let promiseId: number | null = null
	const chunks = new Map<number, { data?: unknown; error?: unknown }>()

	for (const line of body.split("\n")) {
		if (!line.trim()) continue
		let message: unknown
		try {
			message = JSON.parse(line)
		} catch {
			throw new Error(`Ari answered with something that is not page data: ${line.slice(0, 200)}`)
		}
		if (!isRecord(message)) continue

		if (message.type === "redirect")
			throw new Error(
				`Ari asked for a sign-in (redirect to ${String(message.location)}): the cookie is missing, expired, or not signed in.`,
			)

		if (message.type === "data" && Array.isArray(message.nodes)) {
			const { nodes: pageNodes } = message
			nodes = pageNodes
			continue
		}
		if (message.type === "chunk" && typeof message.id === "number")
			chunks.set(message.id, {
				data: "data" in message ? message.data : undefined,
				error: "error" in message ? message.error : undefined,
			})
	}

	if (!Array.isArray(nodes))
		throw new Error(`No page data in the response: check that ${program} is a program id and the cookie is signed in.`)

	for (const node of nodes) {
		if (!isRecord(node)) continue
		if (node.type === "error") throw new Error(`Ari refused the request: ${errorText(node.error)}`)
		if (node.type !== "data" || !isRecord(node.data)) continue
		// the page's load returns { events }, and the deferred promise is serialized as its id
		if (typeof node.data.events === "number") promiseId = node.data.events
	}

	if (promiseId === null) throw new Error("No audit log in the page data: the route may have changed.")
	const chunk = chunks.get(promiseId)
	if (!chunk) throw new Error("Ari never sent the audit log: try again, or check the cookie.")
	if (chunk.error !== undefined) throw new Error(`Ari refused the request: ${errorText(chunk.error)}`)
	if (!Array.isArray(chunk.data)) throw new Error("Ari's audit log was not in the format this tool knows.")

	const log = unflatten(chunk.data)
	if (!isRecord(log) || !Array.isArray(log.rows))
		throw new Error("Ari's audit log was not in the format this tool knows.")
	return { rows: log.rows, total: log.total }
}

/** The message (and status, when there is one) of a SvelteKit error payload, given plain or in devalue's flattened form. */
function errorText(raw: unknown): string {
	if (Array.isArray(raw))
		try {
			return errorText(unflatten(raw))
		} catch {
			return JSON.stringify(raw)
		}

	if (!isRecord(raw)) return String(raw)
	const status = typeof raw.status === "number" ? ` ${raw.status}` : ""
	return `${String(raw.message ?? JSON.stringify(raw))}${status}`
}

function textOf(value: unknown): string {
	return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value)
}

/** Keep the audit fields, and flatten the page's display-only ones away. */
function toAuditRow(raw: unknown): AuditRow {
	if (!isRecord(raw)) throw new Error(`Unexpected audit row: ${JSON.stringify(raw)}`)
	return {
		action: textOf(raw.action),
		actorName: textOf(raw.actorName),
		actorSlackId: typeof raw.actorSlackId === "string" ? raw.actorSlackId : null,
		detail: textOf(raw.detail),
		details: (Array.isArray(raw.detailRows) ? raw.detailRows : []).flatMap(row => {
			if (!isRecord(row)) return []
			return [{ key: textOf(row.key), value: textOf(row.value) }]
		}),
		href: typeof raw.href === "string" ? raw.href : null,
		id: textOf(raw.id),
		iso: textOf(raw.iso),
		submissionId: textOf(raw.submissionId),
		text: textOf(raw.text),
	}
}

/** Quote a CSV field only when it needs it, doubling the quotes inside. */
function csvField(value: string): string {
	if (!/[",\n\r]/.test(value)) return value
	return `"${value.replaceAll('"', '""')}"`
}

function toCsv(rows: AuditRow[]): string {
	const header = ["id", "iso", "action", "actor", "actor_slack_id", "text", "detail", "details", "submission_id", "url"]
	const lines = rows.map(row =>
		[
			row.id,
			row.iso,
			row.action,
			row.actorName,
			row.actorSlackId ?? "",
			row.text,
			row.detail,
			row.details.map(entry => `${entry.key}: ${entry.value}`).join("; "),
			row.submissionId,
			row.href ?? "",
		]
			.map(csvField)
			.join(","),
	)
	return `${[header.join(","), ...lines].join("\n")}\n`
}

function render(rows: AuditRow[], options: Options, program: string): string {
	if (options.format === "csv") return toCsv(rows)
	if (options.format === "ndjson") return `${rows.map(row => JSON.stringify(row)).join("\n")}\n`
	const document = {
		fetchedAt: new Date().toISOString(),
		program,
		rows,
		source: `${BASE}/p/${program}/activity`,
		total: rows.length,
	}
	return `${JSON.stringify(document, null, "\t")}\n`
}

async function download(program: string, cookie: string): Promise<AuditLog> {
	const url = `${BASE}/p/${program}/activity/__data.json?all=1`
	const response = await fetch(url, {
		headers: { Accept: "text/sveltekit-data, application/json", Cookie: `${COOKIE_NAME}=${cookie}` },
	})
	const body = await response.text()
	if (!response.ok) {
		const hint = response.status === 429 ? " Ari is rate limiting this address; wait and try again." : ""
		throw new Error(`Ari answered HTTP ${response.status} for ${url}: ${body.slice(0, 200)}${hint}`)
	}
	return readPageData(body, program)
}

async function main(): Promise<void> {
	const options = readOptions(process.argv.slice(2))
	const log = await download(options.program, options.cookie)
	const rows = log.rows.map(toAuditRow)
	const total = typeof log.total === "number" ? log.total : rows.length
	const rendered = render(rows, options, options.program)

	if (options.out === "-") process.stdout.write(rendered)
	else await writeFile(options.out, rendered)

	const stamps = rows.map(row => row.iso).filter(iso => iso !== "")
	stamps.sort()
	const newest = stamps.at(-1) ?? "—"
	const oldest = stamps[0] ?? "—"
	console.log(`${rows.length} audit event(s) for ${options.program} (Ari counts ${total})`)
	console.log(`newest ${newest}, oldest ${oldest}`)
	if (rows.length < total)
		console.log(
			`Ari sent ${rows.length} of ${total} events: the endpoint ignored ?all=1, or the log changed while reading.`,
		)
	if (options.out === "-") console.log("Wrote the log to stdout.")
	else console.log(`Wrote ${options.out}`)
}

void (async () => {
	try {
		await main()
	} catch (err) {
		console.error(err instanceof Error ? err.message : err)
		process.exit(1)
	}
})()

export { main }
