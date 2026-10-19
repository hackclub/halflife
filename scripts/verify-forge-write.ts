import "dotenv/config"
import { HttpError } from "../src/lib/errors"
import { FORGES } from "../src/lib/forge"
import { commitFiles, defaultBranchOf } from "../src/lib/forge-write"
import type { RepoRef } from "../src/lib/repo-ref"

/**
 * The write path's retry and status classification.
 *
 * The failure this pins down: writing had none of the read path's retries, so a dropped connection, a slow moment or a rate limit was recorded against the project as "GitHub did not answer" – and a rate-limit 403 was reported as "refused that, reconnect GitHub", which is advice that cannot help. `call` now classifies an answer and retries what another attempt could clear.
 *
 * `defaultBranchOf` is driven for the status cases because it is exactly one `call`, so a scripted `fetch` sees every attempt. A whole `commitFiles` is then driven to pin the tree it builds, including the legacy BOM.md deletion. Credentials are built by hand, so no database is touched beyond the import.
 *
 * Run with `bun --conditions=react-server scripts/verify-forge-write.ts`.
 */

let failures = 0
function check(label: string, ok: boolean, detail = "") {
	if (!ok) failures++
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `: ${detail}`}`)
}

const forge = FORGES.github
const creds = { accessToken: "token", forge, login: "maker" }
const ref = { fullName: "owner/repo" } as RepoRef

interface Step {
	body?: unknown
	headers?: { [_: string]: string }
	status: number
	throw?: boolean
}
let script: Step[] = []
let calls = 0

globalThis.fetch = (() => {
	// Once the script is spent, the last step repeats, so an exhausted retry can be observed.
	const step = script[calls] ?? script.at(-1)
	calls++
	if (!step) throw new Error("fetch called with no scripted step")
	if (step.throw) throw new TypeError("fetch failed")
	return Promise.resolve(
		new Response(step.body === undefined ? null : JSON.stringify(step.body), {
			headers: { "content-type": "application/json", ...step.headers },
			status: step.status,
		}),
	)
}) as typeof fetch

async function run(steps: Step[]): Promise<{ ok: true; value: string } | { ok: false; err: unknown }> {
	script = steps
	calls = 0
	try {
		return { ok: true, value: await defaultBranchOf(creds, ref) }
	} catch (err) {
		return { err, ok: false }
	}
}

async function main() {
	// A transient 5xx is the forge failing at its end, and another attempt clears it.
	{
		const r = await run([
			{ body: { message: "server error" }, status: 500 },
			{ body: { default_branch: "main" }, status: 200 },
		])
		check("5xx · retried to success", r.ok && r.value === "main", JSON.stringify(r))
		check("5xx · took two attempts", calls === 2, `calls=${calls}`)
	}

	// GitHub's primary rate limit: 403 with the quota header at zero.
	{
		const r = await run([
			{
				headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": `${Math.ceil(Date.now() / 1000)}` },
				status: 403,
			},
			{ body: { default_branch: "main" }, status: 200 },
		])
		check("403 primary rate limit · waited out, not read as a refusal", r.ok && r.value === "main", JSON.stringify(r))
	}

	// GitHub's secondary rate limit: 403 carrying a retry-after.
	{
		const r = await run([
			{ headers: { "retry-after": "1" }, status: 403 },
			{ body: { default_branch: "main" }, status: 200 },
		])
		check("403 secondary rate limit · waited out, not read as a refusal", r.ok && r.value === "main", JSON.stringify(r))
	}

	// A 401 is a sign-in to redo, and says so specifically.
	{
		const r = await run([{ body: { message: "Bad credentials" }, status: 401 }])
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
		const r = await run([{ body: { message: "Resource not accessible by integration" }, status: 403 }])
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
		const always = { headers: { "retry-after": "1" }, status: 429 }
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
			{ body: { default_branch: "main" }, status: 200 },
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
		const r = await run([{ body: { message: "Protected branch update failed" }, status: 422 }])
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
		const r = await run([{ body: { message: "Problems parsing JSON" }, status: 400 }])
		const err = r.ok ? null : r.err
		const message = err instanceof Error ? err.message : String(err)
		check("400 · named with its status code", !r.ok && message.includes("returned an error (400)"), message)
		check("400 · surfaces the body message", message.includes("Problems parsing JSON"), message)
	}

	// A 500 that survives every retry reads as the forge's own problem, and is not quoted as if the maker caused it.
	{
		const always = { body: { message: "Server Error" }, status: 503 }
		const r = await run([always, always, always, always])
		const err = r.ok ? null : r.err
		const message = err instanceof Error ? err.message : String(err)
		check(
			"503 exhausted · reads as the forge having a problem",
			!r.ok && message.includes("having a problem (503)"),
			message,
		)
	}

	// A whole commit, with BOM.md still in the repo so the legacy deletion is sent. Every tree entry needs a mode and a type, the null-sha deletion included: omitting them made GitHub answer "Must supply a valid tree.mode".
	{
		interface TreeEntry {
			mode?: string
			path: string
			sha: string | null
			type?: string
		}
		// A holder rather than a `let`: the tree body is captured inside the fetch closure, and a plain `let` would be narrowed to null across it.
		const captured: { tree: TreeEntry[] | null } = { tree: null }
		let blobs = 0
		globalThis.fetch = ((url: string, init: RequestInit = {}) => {
			const method = init.method ?? "GET"
			const u = String(url)
			const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }))
			if (method === "GET" && u.includes("/git/ref/heads/")) return json({ object: { sha: "parent" } })
			if (method === "GET" && u.includes("/git/commits/parent")) return json({ tree: { sha: "tree0" } })
			// The old BOM.md is still present, which is what makes the sync send a deletion for it.
			if (method === "GET" && u.includes("/git/trees/tree0"))
				return json({ tree: [{ mode: "100644", path: "BOM.md", sha: "old", type: "blob" }] })
			if (method === "POST" && u.endsWith("/git/blobs")) return json({ sha: `blob${blobs++}` })
			if (method === "POST" && u.endsWith("/git/trees")) {
				captured.tree = (JSON.parse(String(init.body)) as { tree: TreeEntry[] }).tree
				return json({ sha: "tree1" })
			}
			if (method === "POST" && u.endsWith("/git/commits")) return json({ sha: "commit1" })
			if (method === "PATCH" && u.includes("/git/refs/heads/")) return json({})
			return json({ message: `unexpected ${method} ${u}` }, 500)
		}) as typeof fetch

		await commitFiles(
			creds,
			ref,
			"main",
			[
				{ content: "# Journal\n", path: "JOURNAL.md" },
				{ content: "name,qty\n", path: "BOM.csv" },
				{ content: null, path: "BOM.md" },
			],
			"Sync from Half Life",
		)

		const entries = captured.tree ?? []
		const deletion = entries.find(e => e.path === "BOM.md")
		const write = entries.find(e => e.path === "JOURNAL.md")
		check(
			"tree · a deletion entry carries a mode and type",
			deletion?.mode === "100644" && deletion?.type === "blob" && deletion?.sha === null,
			JSON.stringify(deletion),
		)
		check(
			"tree · a write entry carries a mode and type",
			write?.mode === "100644" && write?.type === "blob" && typeof write.sha === "string" && write.sha.length > 0,
			JSON.stringify(write),
		)
	}

	console.log(failures === 0 ? "\nAll forge-write checks passed" : `\n${failures} check(s) failed`)
	process.exit(failures === 0 ? 0 : 1)
}

void main()
