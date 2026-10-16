/**
 * Resend every decision in an Ari program's "Reviewed" list, using your logged-in cookie.
 *
 * Ari has no bulk resend API. The dashboard's Resend button is a `fetch` from `submitAction` (`$lib/actions.ts`) to `?/resend` on the Reviewed page, with `x-sveltekit-action: true` and a `FormData` body of `id=<submissionId>`, which runs `redispatchLastReview` on the server and queues a fresh webhook delivery. This walks every Reviewed page, reads the submission ids out of the row links (`/p/<program>/review/<id>`) and sends that same request once per ship.
 *
 * The session cookie is what authenticates it, so this is a local operator tool rather than a job: sign in to ari.hackclub.com, copy the value of its `ari_session` cookie (DevTools → Application → Cookies, or the same-named value on any request), and put it in `ARI_COOKIE` (or `--cookie`). The account needs `OVERRIDE_DECISIONS`.
 *
 * Ships go out `--concurrency` at a time (default 5). A 429 backs every worker off, honouring `Retry-After` when it is present and otherwise doubling a jittered delay per consecutive hit; a gateway error, a 5xx or a dropped connection is retried the same way. A refusal (no endpoint, nothing to resend) is final and reported once. Only the queueing is ours to pace: ari-webhooks sends the queued deliveries at its own rate.
 *
 * Read-only unless `--commit`, which lists what it would send. Resends are safe to repeat: Ari deliveries are idempotent per delivery id, and half-life records a resent decision for an already-decided ship without crediting anything twice or notifying the maker again.
 *
 * Run with `bun run ari:resend-all` (dry run), then `bun run ari:resend-all -- --limit 1 --commit` to prove the cookie and permissions on one ship before `bun run ari:resend-all -- --commit`.
 *
 * Flags: `--program`, `--cookie`, `--concurrency` (5), `--max-attempts` (5), `--delay` (0), `--limit`, `--commit`.
 * Env: `ARI_PROGRAM`, `ARI_COOKIE`, `ARI_CONCURRENCY`, `ARI_MAX_ATTEMPTS`, `ARI_DELAY`, `ARI_BASE`.
 */

const BASE = process.env.ARI_BASE ?? "https://ari.hackclub.com"
/** Half Life's program id, so a run against it needs no argument. */
const DEFAULT_PROGRAM = "cmtkgvs59016w01ny164gthi9"
/** Ari's session cookie (`sessionCookie` in `src/lib/server/auth.ts`). */
const COOKIE_NAME = "ari_session"

/** Backoff for a rate limit or a transient failure: doubled per consecutive hit, capped, and jittered so workers do not resynchronise. */
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 30_000
const DEFAULT_CONCURRENCY = 5
const DEFAULT_MAX_ATTEMPTS = 5

type Options = {
	commit: boolean
	concurrency: number
	cookie: string
	delayMs: number
	limit: number | null
	maxAttempts: number
	program: string
}

/** Shared across workers: a 429 parks every one of them, not just the caller. */
type Limiter = { cooldownUntil: number; streak: number }

type SendOutcome = "refused" | "resent" | "retry"
type TaskOutcome = "failed" | "refused" | "resent"

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** ±20%, so workers that backed off together do not all retry on the same tick. */
const jitter = (ms: number): number => Math.round(ms * (0.8 + Math.random() * 0.4))

/** The value of a `--name=value` or `--name value` flag, or null when it is absent. */
function flagValue(args: string[], name: string): string | null {
	for (const [index, arg] of args.entries()) {
		if (arg === `--${name}`) return args[index + 1] ?? null
		if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3)
	}
	return null
}

function positiveInt(raw: string, flag: string): number {
	const value = Number(raw)
	if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer, got ${raw}`)
	return value
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
	const delay = Number(flagValue(args, "delay") ?? process.env.ARI_DELAY ?? "0")
	const limitRaw = flagValue(args, "limit")
	const concurrency = positiveInt(
		flagValue(args, "concurrency") ?? process.env.ARI_CONCURRENCY ?? String(DEFAULT_CONCURRENCY),
		"--concurrency",
	)
	const maxAttempts = positiveInt(
		flagValue(args, "max-attempts") ?? process.env.ARI_MAX_ATTEMPTS ?? String(DEFAULT_MAX_ATTEMPTS),
		"--max-attempts",
	)

	if (!cookie) throw new Error("Set ARI_COOKIE (or --cookie) to the value of your ari_session cookie.")
	if (!Number.isFinite(delay) || delay < 0) throw new Error(`--delay must be a non-negative number, got ${delay}`)

	return {
		commit: args.includes("--commit"),
		concurrency,
		cookie,
		delayMs: Math.round(delay * 1000),
		limit: limitRaw === null ? null : positiveInt(limitRaw, "--limit"),
		maxAttempts,
		program,
	}
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

/** The type and status of a SvelteKit action result, or null when the body was not one. */
function actionResult(body: string): { status: number | null; type: string } | null {
	try {
		const parsed = JSON.parse(body) as { status?: unknown; type?: unknown }
		if (typeof parsed.type !== "string") return null
		return { status: typeof parsed.status === "number" ? parsed.status : null, type: parsed.type }
	} catch {
		return null
	}
}

/** How long a 429 asked us to wait: seconds, or an HTTP date. Null when it did not say. */
function retryAfterDelay(response: Response): number | null {
	const header = response.headers.get("retry-after")
	if (!header) return null
	const seconds = Number(header)
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
	const date = Date.parse(header)
	return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

async function sendResend(
	program: string,
	cookie: string,
	id: string,
): Promise<{ body: string; outcome: SendOutcome; retryAfterMs: number | null; status: number }> {
	const form = new FormData()
	form.append("id", id)

	let response: Response
	try {
		response = await fetch(`${BASE}/p/${program}/reviewed?/resend`, {
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
	} catch {
		// a dropped connection or a timeout is worth another try
		return { body: "", outcome: "retry", retryAfterMs: null, status: 0 }
	}

	const body = await response.text()
	if (response.status === 429) return { body, outcome: "retry", retryAfterMs: retryAfterDelay(response), status: 429 }

	const result = actionResult(body)
	const status = result?.status ?? response.status
	if (result?.type === "success") return { body, outcome: "resent", retryAfterMs: null, status }
	// a refusal (no endpoint, nothing to resend) is final; a 5xx failure, or a gateway error that is not an action result, is worth another try
	if (result?.type === "failure" && status < 500) return { body, outcome: "refused", retryAfterMs: null, status }
	if (status >= 500) return { body, outcome: "retry", retryAfterMs: null, status }
	return { body, outcome: "refused", retryAfterMs: null, status }
}

/** Park every worker, honouring `Retry-After` when a 429 gave one. */
function noteRateLimit(limiter: Limiter, retryAfterMs: number | null): void {
	limiter.streak += 1
	const wait = retryAfterMs ?? Math.min(BASE_BACKOFF_MS * 2 ** (limiter.streak - 1), MAX_BACKOFF_MS)
	limiter.cooldownUntil = Math.max(limiter.cooldownUntil, Date.now() + jitter(wait))
}

async function resendOne(
	options: Options,
	limiter: Limiter,
	id: string,
): Promise<{ detail: string; outcome: TaskOutcome }> {
	let lastBody = ""
	for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
		const wait = limiter.cooldownUntil - Date.now()
		if (wait > 0) await sleep(wait)
		if (options.delayMs > 0) await sleep(options.delayMs)

		const result = await sendResend(options.program, options.cookie, id)
		lastBody = result.body
		if (result.outcome === "resent") {
			limiter.streak = 0
			return { detail: "", outcome: "resent" }
		}
		if (result.outcome === "refused") return { detail: result.body, outcome: "refused" }

		// the rate limit already parked every worker; a transient failure backs off just this one
		if (result.status === 429) noteRateLimit(limiter, result.retryAfterMs)
		else await sleep(jitter(Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS)))
	}
	return { detail: lastBody, outcome: "failed" }
}

/** Run `worker` over `items`, at most `concurrency` at a time. */
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
	let next = 0
	const run = async (): Promise<void> => {
		while (true) {
			const item = items[next]
			next += 1
			if (item === undefined) return
			await worker(item)
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
}

async function main(): Promise<void> {
	const options = readOptions(process.argv.slice(2))
	const ids = await collectIds(options.program, options.cookie)
	console.log(`Collected ${ids.length} ship id(s) from the Reviewed list`)

	const targets = options.limit === null ? ids : ids.slice(0, options.limit)
	if (!options.commit) {
		for (const id of targets) console.log(`would resend ${id}`)
		console.log(`Dry run: ${targets.length} ship(s). Pass --commit to actually resend.`)
		return
	}

	console.log(`Resending ${targets.length} ship(s), ${options.concurrency} at a time`)
	const limiter: Limiter = { cooldownUntil: 0, streak: 0 }
	const totals: Record<TaskOutcome, number> = { failed: 0, refused: 0, resent: 0 }
	let done = 0

	await runPool(targets, options.concurrency, async id => {
		const result = await resendOne(options, limiter, id)
		done += 1
		totals[result.outcome] += 1
		if (result.outcome === "resent") console.log(`[${done}/${targets.length}] resent  ${id}`)
		else if (result.outcome === "refused") console.log(`[${done}/${targets.length}] refused ${id}: ${result.detail}`)
		else console.log(`[${done}/${targets.length}] failed  ${id}: ${result.detail}`)
	})

	console.log(`Done: ${totals.resent} resent, ${totals.refused} refused, ${totals.failed} failed`)
	if (totals.refused + totals.failed > 0) process.exitCode = 1
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
})
