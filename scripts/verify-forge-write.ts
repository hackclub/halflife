import "dotenv/config"
import { HttpError } from "../src/lib/errors"
import { FORGES } from "../src/lib/forge"
import { defaultBranchOf } from "../src/lib/forge-write"
import type { RepoRef } from "../src/lib/repo-ref"

/**
 * The write path's retry and status classification.
 *
 * The failure this pins down: writing had none of the read path's retries, so a dropped connection, a slow moment or a rate limit was recorded against the project as "GitHub did not answer" – and a rate-limit 403 was reported as "refused that, reconnect GitHub", which is advice that cannot help. `call` now classifies an answer and retries what another attempt could clear.
 *
 * `defaultBranchOf` is driven here because it is exactly one `call`, so a scripted `fetch` sees every attempt. Credentials are built by hand, so no database is touched beyond the import.
 *
 * Run with `bun --conditions=react-server scripts/verify-forge-write.ts`.
 */

let failures = 0
function check(label: string, ok: boolean, detail = "") {
	if (!ok) failures++
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `: ${detail}`}`)
}

const forge = FORGES.github
const creds = { forge, login: "maker", accessToken: "token" }
const ref = { fullName: "owner/repo" } as RepoRef

type Step = { status: number; body?: unknown; headers?: Record<string, string>; throw?: boolean }
let script: Step[] = []
let calls = 0

globalThis.fetch = (async () => {
	// Once the script is spent, the last step repeats, so an exhausted retry can be observed.
	const step = script[calls] ?? script[script.length - 1]
	calls++
	if (!step) throw new Error("fetch called with no scripted step")
	if (step.throw) throw new TypeError("fetch failed")
	return new Response(step.body === undefined ? null : JSON.stringify(step.body), {
		status: step.status,
		headers: { "content-type": "application/json", ...(step.headers ?? {}) },
	})
}) as typeof fetch

async function run(steps: Step[]): Promise<{ ok: true; value: string } | { ok: false; err: unknown }> {
	script = steps
	calls = 0
	try {
		return { ok: true, value: await defaultBranchOf(creds, ref) }
	} catch (err) {
		return { ok: false, err }
	}
}

async function main() {
	// A transient 5xx is the forge failing at its end, and another attempt clears it.
	{
		const r = await run([
			{ status: 500, body: { message: "server error" } },
			{ status: 200, body: { default_branch: "main" } },
		])
		check("5xx · retried to success", r.ok && r.value === "main", JSON.stringify(r))
		check("5xx · took two attempts", calls === 2, `calls=${calls}`)
	}

	// GitHub's primary rate limit: 403 with the quota header at zero.
	{
		const r = await run([
			{
				status: 403,
				headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": `${Math.ceil(Date.now() / 1000)}` },
			},
			{ status: 200, body: { default_branch: "main" } },
		])
		check("403 primary rate limit · waited out, not read as a refusal", r.ok && r.value === "main", JSON.stringify(r))
	}

	// GitHub's secondary rate limit: 403 carrying a retry-after.
	{
		const r = await run([
			{ status: 403, headers: { "retry-after": "1" } },
			{ status: 200, body: { default_branch: "main" } },
		])
		check("403 secondary rate limit · waited out, not read as a refusal", r.ok && r.value === "main", JSON.stringify(r))
	}

	// A 401 is a sign-in to redo, and says so specifically.
	{
		const r = await run([{ status: 401, body: { message: "Bad credentials" } }])
		const err = r.ok ? null : r.err
		check(
			"401 · reads as a sign-in to reconnect",
			!r.ok && err instanceof HttpError && err.message.includes("sign-in is no longer valid"),
			err instanceof Error ? err.message : String(err),
		)
		check("401 · not retried", calls === 1, `calls=${calls}`)
	}

	// A 403 with no rate-limit header is the genuine refusal a maker must act on, and names permissions.
	{
		const r = await run([{ status: 403, body: { message: "Resource not accessible by integration" } }])
		const err = r.ok ? null : r.err
		check(
			"403 plain · reads as a permissions problem to reconnect over",
			!r.ok && err instanceof HttpError && err.message.includes("refused this"),
			err instanceof Error ? err.message : String(err),
		)
		check("403 plain · not retried", calls === 1, `calls=${calls}`)
	}

	// An exhausted 429 says so, rather than the old catch-all that blamed silence.
	{
		const always = { status: 429, headers: { "retry-after": "1" } }
		const r = await run([always, always, always, always])
		const err = r.ok ? null : r.err
		check(
			"429 exhausted · reads as rate-limiting, not did-not-answer",
			!r.ok && err instanceof Error && err.message.includes("rate-limiting"),
			err instanceof Error ? err.message : String(err),
		)
	}

	// A thrown fetch is a transport failure, and is retried the same way.
	{
		const r = await run([
			{ status: 0, throw: true },
			{ status: 200, body: { default_branch: "main" } },
		])
		check("transport failure · retried to success", r.ok && r.value === "main", JSON.stringify(r))
	}

	// A 404 is a finding with its own message, and must not be retried.
	{
		const r = await run([{ status: 404 }])
		const err = r.ok ? null : r.err
		check(
			"404 · reads as not-found, not did-not-answer",
			!r.ok && err instanceof HttpError && err.message.includes("does not exist"),
			err instanceof Error ? err.message : String(err),
		)
		check("404 · not retried", calls === 1, `calls=${calls}`)
	}

	// A 422 gets its own sentence, and quotes the forge's own reason.
	{
		const r = await run([{ status: 422, body: { message: "Protected branch update failed" } }])
		const err = r.ok ? null : r.err
		const message = err instanceof Error ? err.message : String(err)
		check(
			"422 · named as a commit the forge would not take",
			!r.ok && message.includes("would not accept the commit"),
			message,
		)
		check("422 · quotes GitHub's own reason", message.includes("Protected branch update failed"), message)
	}

	// Any other status is named with its code, and repeats the forge's message.
	{
		const r = await run([{ status: 400, body: { message: "Problems parsing JSON" } }])
		const err = r.ok ? null : r.err
		const message = err instanceof Error ? err.message : String(err)
		check("400 · named with its status code", !r.ok && message.includes("returned an error (400)"), message)
		check("400 · surfaces the body message", message.includes("Problems parsing JSON"), message)
	}

	// A 500 that survives every retry reads as the forge's own problem, and is not quoted as if the maker caused it.
	{
		const always = { status: 503, body: { message: "Server Error" } }
		const r = await run([always, always, always, always])
		const err = r.ok ? null : r.err
		const message = err instanceof Error ? err.message : String(err)
		check(
			"503 exhausted · reads as the forge having a problem",
			!r.ok && message.includes("having a problem (503)"),
			message,
		)
	}

	console.log(failures === 0 ? "\nAll forge-write checks passed" : `\n${failures} check(s) failed`)
	process.exit(failures === 0 ? 0 : 1)
}

void main()
