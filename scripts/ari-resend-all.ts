/**
 * Resend every decision in an Ari program's "Reviewed" list, using your logged-in cookie.
 *
 * Ari has no bulk resend API. The dashboard's Resend button is a `fetch` from `submitAction` (`$lib/actions.ts`) to `?/resend` on the Reviewed page, with `x-sveltekit-action: true` and a `FormData` body of `id=<submissionId>`, which runs `redispatchLastReview` on the server and queues a fresh webhook delivery. This walks every Reviewed page, reads the submission ids out of the row links (`/p/<program>/review/<id>`) and sends that same request once per ship.
 *
 * The session cookie is what authenticates it, so this is a local operator tool rather than a job: sign in to ari.hackclub.com, copy the value of its `ari_session` cookie (DevTools → Application → Cookies, or the same-named value on any request), and put it in `ARI_COOKIE` (or `--cookie`). The account needs `OVERRIDE_DECISIONS`.
 *
 * Read-only unless `--commit`, which lists what it would send. Resends are safe to repeat: Ari deliveries are idempotent per delivery id, and half-life records a resent decision for an already-decided ship without crediting anything twice or notifying the maker again.
 *
 * Run with `bun run ari:resend-all` (dry run), then `bun run ari:resend-all -- --limit 1 --commit` to prove the cookie and permissions on one ship before `bun run ari:resend-all -- --commit`.
 */

const BASE = process.env.ARI_BASE ?? "https://ari.hackclub.com"
/** Half Life's program id, so a run against it needs no argument. */
const DEFAULT_PROGRAM = "cmtkgvs59016w01ny164gthi9"
/** Ari's session cookie (`sessionCookie` in `src/lib/server/auth.ts`). */
const COOKIE_NAME = "ari_session"

type Options = {
	commit: boolean
	cookie: string
	delayMs: number
	limit: number | null
	program: string
}

type Outcome = "resent" | "refused" | "unknown"

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

function readOptions(args: string[]): Options {
	const program = flagValue(args, "program") ?? process.env.ARI_PROGRAM ?? DEFAULT_PROGRAM
	const cookie = sessionToken(flagValue(args, "cookie") ?? process.env.ARI_COOKIE ?? "")
	const delay = Number(flagValue(args, "delay") ?? process.env.ARI_DELAY ?? "0.3")
	const limitRaw = flagValue(args, "limit")
	const limit = limitRaw === null ? null : Number(limitRaw)

	if (!cookie) throw new Error("Set ARI_COOKIE (or --cookie) to the value of your ari_session cookie.")
	if (!Number.isFinite(delay) || delay < 0) throw new Error(`--delay must be a non-negative number, got ${delay}`)
	if (limit !== null && (!Number.isInteger(limit) || limit <= 0))
		throw new Error(`--limit must be a positive integer, got ${limitRaw}`)

	return { commit: args.includes("--commit"), cookie, delayMs: Math.round(delay * 1000), limit, program }
}

/** Escape a literal for a regular expression, so a program id with punctuation cannot break the match. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Every submission id linked from a Reviewed page's HTML. */
function idsIn(program: string, html: string): string[] {
	const pattern = new RegExp(`/p/${escapeRegExp(program)}/review/[A-Za-z0-9_-]+`, "g")
	return [...html.matchAll(pattern)].map(match => match[0].slice(match[0].lastIndexOf("/") + 1))
}

async function getPage(program: string, cookie: string, page: number): Promise<string> {
	const response = await fetch(`${BASE}/p/${program}/reviewed?page=${page}`, {
		headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
	})
	return response.text()
}

/**
 * Every id in the Reviewed list, across pages.
 *
 * Ari clamps `?page` past the last page to the last page, so a page that adds nothing new is what marks the end rather than an empty one. A first page with no ship links means the cookie is not signed in, the program id is wrong, or the page is unreachable, so it is an error rather than an empty list.
 */
async function collectIds(program: string, cookie: string): Promise<string[]> {
	const ids = new Set<string>()
	for (let page = 1; page <= 1000; page++) {
		const html = await getPage(program, cookie, page)
		if (page === 1 && idsIn(program, html).length === 0)
			throw new Error(
				"No ship links found on the Reviewed page: check that the cookie is signed in and the program id is right.",
			)
		const before = ids.size
		for (const id of idsIn(program, html)) ids.add(id)
		if (ids.size === before) break
	}
	return [...ids]
}

/** The `type` of a SvelteKit action result, or null when the body was not one. */
function actionType(body: string): string | null {
	try {
		const parsed = JSON.parse(body) as { type?: unknown }
		return typeof parsed.type === "string" ? parsed.type : null
	} catch {
		return null
	}
}

async function resend(program: string, cookie: string, id: string): Promise<{ body: string; outcome: Outcome }> {
	const form = new FormData()
	form.append("id", id)

	const response = await fetch(`${BASE}/p/${program}/reviewed?/resend`, {
		body: form,
		headers: {
			Accept: "application/json",
			Cookie: `${COOKIE_NAME}=${cookie}`,
			// SvelteKit's form-action CSRF check, and the header that makes the server answer with the action result JSON.
			Origin: BASE,
			Referer: `${BASE}/p/${program}/reviewed`,
			"x-sveltekit-action": "true",
		},
		method: "POST",
	})
	const body = await response.text()
	const type = actionType(body)
	if (type === "success") return { body, outcome: "resent" }
	if (type === "failure") return { body, outcome: "refused" }
	return { body, outcome: "unknown" }
}

async function main(): Promise<void> {
	const options = readOptions(process.argv.slice(2))
	const ids = await collectIds(options.program, options.cookie)
	console.log(`Collected ${ids.length} ship id(s) from the Reviewed list`)

	const targets = options.limit === null ? ids : ids.slice(0, options.limit)
	let sent = 0
	for (const id of targets) {
		if (!options.commit) {
			console.log(`would resend ${id}`)
			sent += 1
			continue
		}

		const { body, outcome } = await resend(options.program, options.cookie, id)
		if (outcome === "resent") console.log(`resent  ${id}`)
		else if (outcome === "refused") console.log(`refused ${id}: ${body}`)
		else console.log(`unknown ${id}: ${body}`)
		sent += 1

		if (options.delayMs > 0) await new Promise(resolve => setTimeout(resolve, options.delayMs))
	}

	if (options.commit) console.log(`Done: ${sent} ship(s) sent.`)
	else console.log(`Dry run: ${sent} ship(s). Pass --commit to actually resend.`)
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
})
