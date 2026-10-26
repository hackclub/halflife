import "server-only"
import { createHash } from "node:crypto"
import { z } from "zod"
import { createSlot, sleep } from "@/lib/concurrency"
import { HttpError } from "@/lib/errors"
import { type Forge, repoUrl } from "@/lib/forge"
import db from "@/lib/prisma8"
import type { RepoRef } from "@/lib/repo-ref"
import { parseDbTimestamp } from "@/lib/time"
import { isRecord } from "@/lib/unknown"

/**
 * Writing a participant's work back into their own repo, on whichever forge they linked.
 *
 * Read-only checks (lib/forge-read) prove a repo exists and has the files a week needs. This is the other direction: committing the devlogs and parts list the platform already holds into the maker's repo, so their work is readable without a Half Life account.
 *
 * Two differences from the read path matter:
 *
 * - It is the participant's own token, not the shared gh-proxy pool. Reading a public repo is a thing the program does for everyone; writing to someone's repository is done as them, with the access they granted, and must never ride on a token belonging to the program. The proxy pool could not write even if it were offered.
 * - It cannot fall back to the read path's retry-and-back-off machinery: that is built around the shared tokens and the proxy pool. A single HTTP call is retried briefly and rate limits are respected in `call` below, because a dropped connection or a secondary rate limit is the same blip the read path was built to absorb – but a commit that exhausts those is still recorded against the project (and left for the next write, or the maker's own "Sync now") rather than retried as a whole, which could interleave with the next entry's sync.
 *
 * ## Why this file is long
 *
 * The two forges commit a set of files in genuinely different ways, and pretending otherwise would mean one implementation wearing the other's shape:
 *
 * - **GitHub** has no "commit these files" endpoint. Its contents API is per-file, so n files would be n commits and n "Update JOURNAL.md" entries in the maker's history. The Git Data API is used instead – blobs, one tree, one commit, one ref update – which is four round trips and a manual fast-forward guard, but lands atomically and detects a concurrent push.
 * - **GitLab** has `POST /projects/:id/repository/commits` with an `actions[]` array: one request, one commit, create/update/delete decided per action. That is simpler, and takes GitLab's own optional guard (`last_commit_id`) for the same concurrency protection.
 *
 * Each is written the way its API wants to be used, and the shared parts – the no-op-when-unchanged check, the result shape – are hoisted above them.
 */

/** Long enough for a commit, short enough that a stalled call does not hold a job. */
const TIMEOUT_MS = 15_000

/** Attempts after the first that one call gets when the failure is one a retry could clear. */
const RETRY_DELAYS_MS = [300, 1000, 2500]

/** Wait before each retry of a plain transport or 5xx failure, when the answer did not name one itself. */
const RETRY_FALLBACK_MS = 1000

/** In flight at once across every write call. Far under any forge's per-second quota, and low enough that a wave of syncs queues rather than every project firing at once and tripping GitHub's secondary (content-creation) limit. */
const MAX_IN_FLIGHT = 4

/** Longest one call will sit out a rate limit before giving up; the project keeps its error and the next write tries again. */
const MAX_RATE_LIMIT_WAIT_MS = 30_000

/**
 * The caller's forge identity and a token, or null when they have not linked that forge. A revoked or expired token reads the same as never having linked: the UI offers the forge again rather than showing an error nobody can act on.
 */
export interface ForgeCredentials {
	accessToken: string
	forge: Forge
	/** The account's login on that forge, from the account row. */
	login: string
}

export class ForgeWriteUnavailableError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ForgeWriteUnavailableError"
	}
}

/**
 * A refresh already running for one account row.
 *
 * GitLab rotates the refresh token on every use and invalidates the old one, so two requests refreshing the same account cannot both succeed: the second presents a token the first just spent and is refused with `invalid_grant`, on a link that is perfectly healthy. That is not hypothetical here – a repo listing and a project sync can ask for one maker's token in the same second, and each app instance is another independent caller. Joining the in-flight call makes that one refresh with one answer.
 */
const refreshing = new Map<string, Promise<string | null>>()

function refreshAccessToken(accountId: string, userId: string): Promise<string | null> {
	const running = refreshing.get(accountId)
	if (running) return running
	const pending = (async () => {
		try {
			// Imported lazily: lib/auth reaches back into the database and its hooks, and importing it at module scope here would close a cycle.
			const { auth } = await import("@/lib/auth")
			const fresh = await auth.api.getAccessToken({ body: { accountId, userId } })
			return fresh?.accessToken ?? null
		} finally {
			refreshing.delete(accountId)
		}
	})()
	refreshing.set(accountId, pending)
	return pending
}

/**
 * The token for one forge, refreshed when it has expired.
 *
 * Read through `auth.api.getAccessToken`, not straight from the account row. That distinction is the whole reason GitLab is safe to support: GitLab's OAuth access tokens expire after **two hours**, so a token read raw from the database is dead within one syncing session. better-auth's call refreshes it from the stored refresh token and writes the new one back, which is exactly what a two-hour lifetime needs and what GitHub never asked of us (GitHub tokens do not expire).
 *
 * Only an expiring token is refreshed. GitHub has no refresh token and no expiry, so asking better-auth on every sync was a read of every account for an answer that never changed; GitLab is the one that needs it, and a refresh is shared per account rather than fired twice (`refreshAccessToken`).
 *
 * Resolves null when the user has not linked this forge. A refresh that fails keeps the stored token: a concurrent request may have just written a new one, which the re-read below picks up, and the call the caller makes next is what decides whether the old one is dead.
 */
export async function forgeCredentials(userId: string, forge: Forge): Promise<ForgeCredentials | null> {
	const account = await db.orm.public.Account.where({ providerId: forge.id, userId })
		.orderBy(row => row.updatedAt.desc())
		.select("accessToken", "accessTokenExpiresAt", "accountId", "id", "refreshToken")
		.first()
	if (!account?.accessToken) return null

	let { accessToken } = account
	// Matches better-auth's own five-second margin, so a token is refreshed exactly when `getAccessToken` would refresh it.
	const expiring =
		account.accessTokenExpiresAt !== null
		&& parseDbTimestamp(account.accessTokenExpiresAt).getTime() - Date.now() < 5_000
	if (account.refreshToken && expiring)
		try {
			accessToken = (await refreshAccessToken(account.id, userId)) ?? accessToken
		} catch (err) {
			// The losing half of a refresh race is not a broken link: if another request refreshed and persisted while this one failed, its token is the good one.
			const latest = await db.orm.public.Account.whereUnique({ id: account.id }).select("accessToken").first()
			if (latest?.accessToken) ({ accessToken } = latest)
			console.warn(
				`[forge-write] token refresh for ${forge.id} failed for account ${account.id}; using the stored token:`,
				err,
			)
		}

	return { accessToken, forge, login: account.accountId }
}

/** In flight at once. A burst of syncs waits here rather than all hitting one forge at once. */
const slot = createSlot(MAX_IN_FLIGHT)

/**
 * How long an answer asks us to wait, in ms, when it is a rate limit that says so.
 *
 * The two forges spell the reset differently and GitHub sends a delay on one header and an epoch second on another, so both are read: `retry-after` as seconds from now, else `x-ratelimit-reset` / `ratelimit-reset` as an epoch.
 */
function retryAfterMs(res: Response): number | null {
	const retryAfter = Number(res.headers.get("retry-after"))
	if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000
	const reset = Number(res.headers.get("x-ratelimit-reset") ?? res.headers.get("ratelimit-reset"))
	if (Number.isFinite(reset) && reset > 0) return reset * 1000 - Date.now()
	return null
}

/**
 * Whether an answer is a rate limit rather than a real refusal, and the shortest wait that could clear it.
 *
 * GitHub answers **403** for both "this token may not do that" and "you have exhausted the quota", so the status alone cannot tell them apart. The headers do: a primary limit leaves `x-ratelimit-remaining` at 0, and a secondary limit – the per-IP, content-creation one a burst of commits trips – arrives with a `retry-after`. A 403 with neither header is the genuine "reconnect your account" case, and returning null here is what sends it down that path.
 */
function rateLimitWait(res: Response): number | null {
	if (res.status === 429) return Math.max(1000, retryAfterMs(res) ?? 60_000)
	if (res.status !== 403) return null
	const remaining = res.headers.get("x-ratelimit-remaining") ?? res.headers.get("ratelimit-remaining")
	if (remaining === "0") return Math.max(1000, retryAfterMs(res) ?? 60_000)
	const retryAfter = Number(res.headers.get("retry-after"))
	if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.max(1000, retryAfter * 1000)
	return null
}

/**
 * The forge's own sentence from an error body, when it left one worth repeating.
 *
 * Both forges answer a 4xx with JSON that explains it better than the status can – GitHub's "Protected branch update failed", "Resource not accessible by integration", "Repository is empty"; GitLab's `message`/`error`. It is read, tidied and capped here rather than shown raw, so an HTML error page or a wall of links cannot land on a maker's project page.
 */
async function apiDetail(res: Response): Promise<string | null> {
	let text: string
	try {
		text = await res.text()
	} catch {
		return null
	}
	if (!text) return null

	let message = text
	try {
		const body: unknown = JSON.parse(text)
		if (isRecord(body)) {
			const said = body.message ?? body.error
			if (typeof said === "string") message = said
		}
	} catch {
		// Not JSON: a proxy page or a plain-text error, where the text itself is the only detail there is.
	}

	message = message.replaceAll(/\s+/g, " ").trim()
	// An HTML page has no sentence to quote, and reading a regex tag out of one helps nobody.
	if (!message || /<[a-z!/]/i.test(message)) return null
	return message.length > 200 ? `${message.slice(0, 199)}…` : message
}

/**
 * The maker-facing sentence for an answer that came back an error.
 *
 * One status is not one problem, so each says what its own fix is: a 401 is a sign-in to redo, a 403 is permissions to check, a 404 is a repo or branch to find, a 5xx is the forge's own bad day to wait out. The forge's own `message` is quoted after that when it adds something the lead does not, because it often names the exact rule that refused.
 */
async function errorMessage(forge: Forge, res: Response): Promise<string> {
	if (res.status === 401)
		return `Your ${forge.label} sign-in is no longer valid. Reconnect ${forge.label} and try again.`
	if (res.status === 403)
		return `${forge.label} refused this. Reconnect ${forge.label} and try again, or check your write access to the repo.`
	if (res.status === 404) return `The repo or branch was not found, or your ${forge.label} account cannot see it.`
	if (res.status === 429) return `${forge.label} is rate-limiting us right now; wait a minute and try again.`
	if (res.status >= 500)
		return `${forge.label} is having a problem (${res.status}); this is usually temporary, so try the sync again shortly.`

	const detail = await apiDetail(res)
	const lead =
		res.status === 409
			? `${forge.label} reported a conflict: the repo changed while syncing. Nothing was written, so try again.`
			: res.status === 422
				? `${forge.label} would not accept the commit.`
				: `${forge.label} returned an error (${res.status}).`
	return detail ? `${lead} ${forge.label} said: "${detail}"` : lead
}

/**
 * Read the answer and throw the maker-facing error for it. Typed `never`, so a call site reads as the end of its branch and the compiler agrees it cannot fall through to the `res.ok` path.
 */
async function throwForgeError(forge: Forge, res: Response): Promise<never> {
	throw new ForgeWriteUnavailableError(await errorMessage(forge, res))
}

/**
 * One authenticated request, with a short retry for what another attempt could clear.
 *
 * The read path (lib/github) has had this from the start: a dropped connection, a slow moment or a rate limit is retried a couple of times before a person is told anything. Writing had none, so every such blip was recorded against the project as "GitHub did not answer" and left for the next entry – which met the same blip. That is what this fixes, at the level of one HTTP call rather than the whole commit: a retry here cannot interleave with the next entry's sync, because the sync that owns the commit is still the one waiting on it.
 *
 * Retrying is safe because GitHub's Git Data API is written for it: a blob, tree or commit created twice leaves an unreferenced object that is garbage-collected, and the one ref update is guarded on the tip it read, so a lost race is a refused fast-forward rather than a lost commit.
 */
async function call(creds: ForgeCredentials, path: string, init: RequestInit): Promise<Response> {
	const { forge } = creds
	const url = forge.id === "gitlab" ? `https://gitlab.com/api/v4/${path}` : `https://api.github.com/${path}`

	const headers: { [_: string]: string } =
		forge.id === "gitlab"
			? { Accept: "application/json", Authorization: `Bearer ${creds.accessToken}` }
			: {
					Accept: "application/vnd.github+json",
					Authorization: `Bearer ${creds.accessToken}`,
					"X-GitHub-Api-Version": "2022-11-28",
				}

	const method = init.method ?? "GET"
	const mergedHeaders = new Headers(headers)
	for (const [key, value] of new Headers(init.headers)) mergedHeaders.set(key, value)
	// What the maker is told if every attempt fails. A transport failure leaves this at the network wording; a named answer replaces it with the sentence for its status.
	let why = `${forge.label} did not answer after several attempts; this is usually a temporary network or ${forge.label} problem, so try again.`

	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
		const release = await slot()
		let res: Response | null = null
		try {
			res = await fetch(url, {
				...init,
				cache: "no-store",
				headers: mergedHeaders,
				signal: AbortSignal.timeout(TIMEOUT_MS),
			})
		} catch (err) {
			// The maker sees the network wording; the cause is for whoever runs this.
			console.warn(`[forge-write] ${forge.id} ${method} ${path} failed (attempt ${attempt + 1}):`, err)
			why = `${forge.label} did not answer after several attempts; this is usually a temporary network or ${forge.label} problem, so try again.`
		} finally {
			release()
		}
		if (!res) {
			if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt] ?? RETRY_FALLBACK_MS)
			continue
		}

		// A rate limit is not a refusal: wait out the window it named and try again, up to the cap. The last wait is the one that gives up.
		const wait = rateLimitWait(res)
		if (wait !== null) {
			why = `${forge.label} is rate-limiting us right now; wait a minute and try again.`
			if (attempt === RETRY_DELAYS_MS.length) break
			const capped = Math.min(MAX_RATE_LIMIT_WAIT_MS, Math.max(RETRY_DELAYS_MS[attempt] ?? RETRY_FALLBACK_MS, wait))
			console.warn(
				`[forge-write] ${forge.id} ${method} ${path} rate limited (attempt ${attempt + 1}); waiting ${capped}ms`,
			)
			await sleep(capped)
			continue
		}

		// A 5xx is the forge failing at its end, which another attempt often clears. The body is logged for whoever runs this; it is not returned to a maker.
		if (res.status >= 500) {
			if (attempt === RETRY_DELAYS_MS.length) {
				why = await errorMessage(forge, res)
				break
			}
			const body = await res.text().catch(() => "")
			console.warn(
				`[forge-write] ${forge.id} ${method} ${path} → ${res.status} (attempt ${attempt + 1}): ${body.slice(0, 200)}`,
			)
			await sleep(RETRY_DELAYS_MS[attempt] ?? RETRY_FALLBACK_MS)
			continue
		}

		// 401/403 are the two ways a token says it may not do this: revoked, or lacking the scope. A rate-limit 403 was caught above, so this is the genuine refusal. Neither is retried here, and each says which fix it needs.
		if (res.status === 401 || res.status === 403) throw new HttpError("FORBIDDEN", await errorMessage(forge, res))
		return res
	}

	throw new ForgeWriteUnavailableError(why)
}

/** A repo the caller can push to, as the picker shows it. */
export interface WritableRepo {
	defaultBranch: string
	/** `owner/name`, or `group/subgroup/name` on GitLab. */
	fullName: string
	name: string
	/** The whole path to the repo, which may be more than one segment. */
	ownerPath: string
	private: boolean
	pushedAt: string | null
	/** The repo's forge web URL – what the sync stores as its pinned target. */
	url: string
}

/**
 * A page of a repo listing is 100 items and no more, so a listing that stops at the first page shows only the hundred most recently pushed – which for anyone with a long history hides whole organisations behind their own activity. The forges say exactly how many pages exist through their `Link` header, and that is what the loops below follow. This is only a bound on a header that never ends: 100 pages is 10,000 repos, well past where a listing that keeps saying "next" is more likely to be broken than a real account.
 */
const MAX_REPO_LIST_PAGES = 100

/**
 * The `path?query` the `Link` header's `rel="next"` entry points at, ready to hand back to `call`, or null when there is no next page.
 *
 * The forges hand out absolute URLs under their own API root, and `call` prepends that root itself, so it is stripped off again here. Taking the forge's word for which page comes next – rather than incrementing `page` ourselves – is what "fetch them all" means: the loop ends on the page the forge says is the last one, not on whichever count we guessed.
 *
 * The regex deliberately does not split the header on commas first: a next URL can carry commas of its own (`affiliation=owner,collaborator,…`), and a split there would tear the link in half without either half matching.
 */
function nextPagePath(linkHeader: string | null, apiRoot: string): string | null {
	for (const match of (linkHeader ?? "").matchAll(/<([^<>]+)>\s*;\s*rel="?next"?/g)) {
		const [, url] = match
		if (!url) continue
		if (url.startsWith(apiRoot)) return url.slice(apiRoot.length)
		if (url.startsWith("http")) console.warn(`[forge-write] next page outside ${apiRoot}: ${url}`)
	}
	return null
}

/**
 * The repos the caller may write to, newest-pushed first.
 *
 * Every page is followed, so the count is the account's, not the first hundred's. Filtered to what they can actually push to: offering a repo the token cannot write to would let someone turn the sync on and then watch every entry fail with a 403 they cannot fix from here.
 */
export async function listWritableRepos(userId: string, forge: Forge): Promise<WritableRepo[]> {
	const creds = await forgeCredentials(userId, forge)
	if (!creds) return []
	return forge.id === "gitlab" ? listGitLabRepos(creds) : listGitHubRepos(creds)
}

/**
 * The forge payloads this file reads.
 *
 * These are the shapes GitHub and GitLab document, and every read below used to assert them with `as`. A field that moved then surfaced as `undefined` or a TypeError further in; parsing names the field where the payload arrived. Extra keys are ignored, so a forge adding one does not break the sync.
 */
const DefaultBranchBody = z.object({ default_branch: z.string().nullish() })
const RefBody = z.object({ object: z.object({ sha: z.string() }) })
const CommitTreeBody = z.object({ tree: z.object({ sha: z.string() }) })
const ShaBody = z.object({ sha: z.string() })
const GitLabCommitBody = z.object({ id: z.string() })
const TreeBody = z.object({
	tree: z.array(z.object({ path: z.string(), sha: z.string(), type: z.string() })).nullish(),
})
const TreeEntryList = z.array(z.object({ path: z.string(), type: z.string() }))

/** One repo as GitHub's `GET /user/repos` returns it. */
const GitHubRepoSchema = z.object({
	default_branch: z.string(),
	full_name: z.string(),
	name: z.string(),
	owner: z.object({ login: z.string() }),
	permissions: z
		.object({ admin: z.boolean().optional(), maintain: z.boolean().optional(), push: z.boolean().optional() })
		.optional(),
	private: z.boolean(),
	pushed_at: z.string().nullable(),
})
type GitHubRepo = z.infer<typeof GitHubRepoSchema>

async function listGitHubRepos(creds: ForgeCredentials): Promise<WritableRepo[]> {
	// All three affiliations – the API's default is `owner,collaborator, organization_member`, and each is needed to see every repo they can push to: `owner` their own, `collaborator` ones they were added to directly, and `organization_member` the ones reached through an organisation. Org repos are exactly the ones a team grant or an org-wide write role lands on, so dropping that affiliation hid every organisation repository from the picker no matter what was granted at the OAuth prompt. The push filter below still removes anything the token cannot write to.
	let path: string | null = "user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member"
	const repos: GitHubRepo[] = []
	for (let page = 1; path; page++) {
		if (page > MAX_REPO_LIST_PAGES) {
			console.warn(`[forge-write] stopped listing ${creds.forge.label} repos at ${MAX_REPO_LIST_PAGES} pages`)
			break
		}
		const res = await call(creds, path, { method: "GET" })
		if (!res.ok) await throwForgeError(creds.forge, res)
		repos.push(...z.array(GitHubRepoSchema).parse(await res.json()))
		path = nextPagePath(res.headers.get("Link"), "https://api.github.com/")
	}
	const seen = new Set<string>()
	return (
		repos
			// A repo can turn up on two pages when a push lands mid-listing – the `sort=pushed` key moved underneath us. One entry per repo either way.
			.filter(r => {
				if (seen.has(r.full_name)) return false
				seen.add(r.full_name)
				return true
			})
			.filter(r => r.permissions?.push === true || r.permissions?.admin === true || r.permissions?.maintain === true)
			.map(r => ({
				defaultBranch: r.default_branch,
				fullName: r.full_name,
				name: r.name,
				ownerPath: r.owner.login,
				private: r.private,
				pushedAt: r.pushed_at,
				url: repoUrl(creds.forge, r.owner.login, r.name),
			}))
	)
}

/** One project as GitLab's `GET /projects` returns it. */
const GitLabProjectSchema = z.object({
	default_branch: z.string().nullable(),
	last_activity_at: z.string().nullable(),
	name: z.string(),
	namespace: z.object({ full_path: z.string() }),
	path: z.string(),
	path_with_namespace: z.string(),
	visibility: z.string(),
})
type GitLabProject = z.infer<typeof GitLabProjectSchema>

async function listGitLabRepos(creds: ForgeCredentials): Promise<WritableRepo[]> {
	// `membership=true` is "projects I am a member of", which is the closest equivalent to GitHub's owner+collaborator+organisation affiliation. `min_access_level` narrows it to projects they can push to, the same filter GitHub's `permissions.push` applies client-side. Every page is followed for the same reason GitHub's is: one page is 100 projects, and an account with more would otherwise only see the most recently active.
	let path: string | null =
		"projects?membership=true&min_access_level=30&per_page=100&order_by=last_activity_at&sort=desc"
	const projects: GitLabProject[] = []
	for (let page = 1; path; page++) {
		if (page > MAX_REPO_LIST_PAGES) {
			console.warn(`[forge-write] stopped listing ${creds.forge.label} projects at ${MAX_REPO_LIST_PAGES} pages`)
			break
		}
		const res = await call(creds, path, { method: "GET" })
		if (!res.ok) await throwForgeError(creds.forge, res)
		projects.push(...z.array(GitLabProjectSchema).parse(await res.json()))
		path = nextPagePath(res.headers.get("Link"), "https://gitlab.com/api/v4/")
	}
	const seen = new Set<string>()
	return (
		projects
			// Same mid-listing shuffle as GitHub's `sort=pushed`: one entry per project even when activity moves one across a page boundary.
			.filter(p => {
				if (seen.has(p.path_with_namespace)) return false
				seen.add(p.path_with_namespace)
				return true
			})
			.map(p => ({
				// GitLab answers null for a project with no commits yet. The default branch of such a project is `main`, and a commit has to name one, so that is what it falls back to.
				defaultBranch: p.default_branch ?? "main",
				fullName: p.path_with_namespace,
				name: p.name,
				ownerPath: p.namespace.full_path,
				private: p.visibility !== "public",
				pushedAt: p.last_activity_at,
				url: repoUrl(creds.forge, p.namespace.full_path, p.path),
			}))
	)
}

/**
 * How many pages of a repository tree the write path will walk.
 *
 * The read path caps the same walk at 100 pages (lib/repo-checks.ts), and this one reads the same tree for a different reason – to tell a create from an update. Every page is a forge API call with its own retry and back-off, so an unbounded walk would keep a write in flight for a very long time on a pathological repo, or on a forge that keeps offering a next page.
 */
const MAX_TREE_PAGES = 100

export interface FileUpdate {
	/**
	 * The file's new bytes, or null to delete the path.
	 *
	 * Null is how a renamed sync output removes what it used to own: the BOM moved from BOM.md to BOM.csv, and repos synced before the move carry the old file until something deletes it. A delete for a path that is not there is a no-op, so sending it on every sync is idempotent rather than a migration with state to track.
	 */
	content: string | null
	path: string
}

export interface WrittenFile {
	bytes: number
	path: string
	/** The blob sha the forge answered with, for the run history. */
	sha: string
	/** True when the write was a no-op because the file already held this. */
	unchanged: boolean
}

/**
 * Write a set of files to one branch in one commit.
 *
 * A file whose contents already match is left alone rather than rewritten, so the common case – a journal entry that changed nothing about BOM.csv, or a retried sync – produces no commit at all. Both implementations honour that, and both make the whole set land atomically or not at all.
 */
export function commitFiles(
	creds: ForgeCredentials,
	ref: RepoRef,
	branch: string,
	files: FileUpdate[],
	message: string,
): Promise<WrittenFile[]> {
	if (creds.forge.id === "gitlab") return commitGitLab(creds, ref, branch, files, message)
	return commitGitHub(creds, ref, branch, files, message)
}

/**
 * The branch to write to: the repo's default branch.
 *
 * Deliberately not a configured branch. A maker's repo is theirs, and guessing a `devlog` branch that may not exist would fail every write with a 404; the default branch is the one that always exists, and a maker who wants the files elsewhere can merge them or point the sync at a repo that has it.
 */
export async function defaultBranchOf(creds: ForgeCredentials, ref: RepoRef): Promise<string> {
	if (creds.forge.id === "gitlab") {
		const res = await call(creds, `projects/${encodeURIComponent(ref.fullName)}`, { method: "GET" })
		if (res.status === 404) throw new HttpError("NOT_FOUND", `${ref.fullName} does not exist or is not visible.`)
		if (!res.ok) await throwForgeError(creds.forge, res)
		const body = DefaultBranchBody.parse(await res.json())
		return body.default_branch ?? "main"
	}

	const res = await call(creds, `repos/${ref.fullName}`, { method: "GET" })
	if (res.status === 404) throw new HttpError("NOT_FOUND", `${ref.fullName} does not exist or is not visible.`)
	if (!res.ok) await throwForgeError(creds.forge, res)
	const body = DefaultBranchBody.parse(await res.json())
	// An empty repo may answer null; the branch the first commit names has to come from somewhere, and `main` is what GitHub itself would create.
	return body.default_branch ?? "main"
}

/* ── GitHub ─────────────────────────────────────────────────────────────── */

async function commitGitHub(
	creds: ForgeCredentials,
	ref: RepoRef,
	branch: string,
	files: FileUpdate[],
	message: string,
): Promise<WrittenFile[]> {
	const base = `repos/${ref.fullName}`

	// What the branch's tip is. The commit is parented on this, and the ref update is guarded on it still being the tip – so a push that lands between this read and the write fails the whole thing rather than discarding it.
	//
	// An empty repository is the one case where there is no tip to read: GitHub answers 409 ("Git Repository is empty") and refuses the whole Git Data API until the repo has a commit. The Contents API is the documented way in – writing one file initialises the repository and its first branch – after which the read below works as usual. That first file lands in its own commit; the rest still land together in one.
	let refRes = await call(creds, `${base}/git/ref/heads/${encodeURIComponent(branch)}`, { method: "GET" })
	if (refRes.status === 409) {
		// A deletion cannot initialise a repo – there is nothing to delete from an empty one, and the Contents API needs content to write.
		const first = files.find((f): f is { path: string; content: string } => f.content !== null)
		if (!first) return []
		await initializeEmptyGitHubRepo(creds, ref, branch, first, message)
		refRes = await call(creds, `${base}/git/ref/heads/${encodeURIComponent(branch)}`, { method: "GET" })
	}
	if (refRes.status === 404) throw new HttpError("UNPROCESSABLE", `The repo has no branch called ${branch}.`)
	if (!refRes.ok) await throwForgeError(creds.forge, refRes)
	const parentSha = RefBody.parse(await refRes.json()).object.sha

	const commitRes = await call(creds, `${base}/git/commits/${parentSha}`, { method: "GET" })
	if (!commitRes.ok) await throwForgeError(creds.forge, commitRes)
	const treeSha = CommitTreeBody.parse(await commitRes.json()).tree.sha

	// One blob per changed file, in parallel. Unchanged ones are skipped before a blob is ever made: comparing requires their current blob sha, which the tree listing already gives us.
	const current = await currentBlobShas(creds, base, treeSha)
	const written: WrittenFile[] = []
	const entries: { path: string; sha: string | null }[] = []

	await Promise.all(
		files.map(async file => {
			// A deletion: nothing to hash or upload. Absent from the tree means there is nothing to do; present means a tree entry with a null sha, which is how the Git Data API deletes.
			if (file.content === null) {
				if (!current.has(file.path)) {
					written.push({ bytes: 0, path: file.path, sha: "", unchanged: true })
					return
				}
				entries.push({ path: file.path, sha: null })
				written.push({ bytes: 0, path: file.path, sha: "", unchanged: false })
				return
			}
			const sha = blobSha(file.content)
			if (current.get(file.path) === sha) {
				written.push({ bytes: byteLength(file.content), path: file.path, sha, unchanged: true })
				// Still in the tree – an unchanged file is simply not re-added.
				return
			}
			const blobRes = await call(creds, `${base}/git/blobs`, {
				body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			if (!blobRes.ok) await throwForgeError(creds.forge, blobRes)
			const blob = ShaBody.parse(await blobRes.json())
			entries.push({ path: file.path, sha: blob.sha })
			written.push({ bytes: byteLength(file.content), path: file.path, sha: blob.sha, unchanged: false })
		}),
	)

	if (entries.length === 0)
		// Every file already held this content. No tree, no commit, no ref update.
		return written.toSorted((a, b) => a.path.localeCompare(b.path))

	const treeRes = await call(creds, `${base}/git/trees`, {
		body: JSON.stringify({
			base_tree: treeSha,
			// A null sha deletes the path and anything else rewrites it, but every entry still carries mode and type – GitHub rejects a null-sha entry that omits them with "Must supply a valid tree.mode", which is what a legacy BOM.md deletion used to return.
			tree: entries.map(e => ({ mode: "100644", path: e.path, sha: e.sha, type: "blob" })),
		}),
		headers: { "content-type": "application/json" },
		method: "POST",
	})
	if (!treeRes.ok) await throwForgeError(creds.forge, treeRes)
	const newTree = ShaBody.parse(await treeRes.json()).sha

	const newCommitRes = await call(creds, `${base}/git/commits`, {
		body: JSON.stringify({ message, parents: [parentSha], tree: newTree }),
		headers: { "content-type": "application/json" },
		method: "POST",
	})
	if (!newCommitRes.ok) await throwForgeError(creds.forge, newCommitRes)
	const commit = ShaBody.parse(await newCommitRes.json()).sha

	// Guarded: only fast-forward if the ref is still where we read it. A concurrent push makes this a 422 and nothing is written, which is the correct outcome – the next sync reads the new tip and commits on top of it.
	const updateRes = await call(creds, `${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
		body: JSON.stringify({ force: false, sha: commit }),
		headers: { "content-type": "application/json" },
		method: "PATCH",
	})
	if (updateRes.status === 422)
		throw new HttpError("CONFLICT", "The repo moved while syncing. Nothing was written; try again.")
	if (!updateRes.ok) await throwForgeError(creds.forge, updateRes)

	return written.toSorted((a, b) => a.path.localeCompare(b.path))
}

/**
 * Give a repo with no commits its first one, so the Git Data API can be used on it. GitHub refuses blobs, trees and commits on an empty repository (409), and names the Contents API as the one endpoint that can initialise it: writing a single file creates the commit and, with it, the branch. Named branch because an empty repo has no default for GitHub to fall back to.
 *
 * https://docs.github.com/rest/guides/using-the-rest-api-to-interact-with-your-git-database
 */
async function initializeEmptyGitHubRepo(
	creds: ForgeCredentials,
	ref: RepoRef,
	branch: string,
	file: { path: string; content: string },
	message: string,
): Promise<void> {
	const path = file.path.split("/").map(encodeURIComponent).join("/")
	const res = await call(creds, `repos/${ref.fullName}/contents/${path}`, {
		body: JSON.stringify({
			branch,
			// The Contents API wants the bytes base64-encoded, not the text.
			content: Buffer.from(file.content, "utf-8").toString("base64"),
			message,
		}),
		headers: { "content-type": "application/json" },
		method: "PUT",
	})
	if (!res.ok) await throwForgeError(creds.forge, res)
}

/** `path -> blob sha` for one tree, so an unchanged file can be spotted. */
async function currentBlobShas(creds: ForgeCredentials, base: string, treeSha: string): Promise<Map<string, string>> {
	const res = await call(creds, `${base}/git/trees/${treeSha}?recursive=1`, { method: "GET" })
	const out = new Map<string, string>()
	if (!res.ok) return out
	const body = TreeBody.parse(await res.json())
	for (const entry of body.tree ?? []) if (entry.type === "blob") out.set(entry.path, entry.sha)
	return out
}

/**
 * The blob sha GitHub would give this content: SHA-1 over `blob <len>\0<content>`.
 *
 * Computed here rather than asked for, because asking means uploading each file twice – once to check, once to write – and the hash is the documented, stable way to compare against what the tree already holds.
 */
function blobSha(content: string): string {
	const bytes = Buffer.from(content, "utf-8")
	const header = Buffer.from(`blob ${bytes.length}\0`, "utf-8")
	return createHash("sha1").update(header).update(bytes).digest("hex")
}

function byteLength(content: string): number {
	return Buffer.byteLength(content, "utf-8")
}

/* ── GitLab ─────────────────────────────────────────────────────────────── */

/**
 * One request: `POST /projects/:id/repository/commits` with an `actions[]` set.
 *
 * GitLab wants `create` for a file that is not in the repo and `update` for one that is; sending the wrong one fails the whole commit. So the file list is read first, and each action is labelled from what it found. That read is also what the no-op check needs – a file whose content already matches is left out of the actions entirely.
 *
 * There is no blob hash to compare against here (that is a GitHub concept), so the comparison is on the file's content directly, which is what the raw-file endpoint returns.
 */
async function commitGitLab(
	creds: ForgeCredentials,
	ref: RepoRef,
	branch: string,
	files: FileUpdate[],
	message: string,
): Promise<WrittenFile[]> {
	const project = encodeURIComponent(ref.fullName)

	// The branch tip, for the optimistic guard. `last_commit_id` makes GitLab refuse the commit if the file has moved since; the tree listing below is read at this same tip, so the two agree.
	const treeRes = await call(
		creds,
		`projects/${project}/repository/tree?ref=${encodeURIComponent(branch)}&per_page=100`,
		{
			method: "GET",
		},
	)
	if (treeRes.status === 404) throw new HttpError("UNPROCESSABLE", `The repo has no branch called ${branch}.`)
	if (!treeRes.ok) await throwForgeError(creds.forge, treeRes)

	// The listing is paginated; walk it so a repo with many files does not make an existing file look new (which would fail the commit with "file exists").
	const existing = new Map<string, string>()
	let page = 1
	for (let fetched = 0; fetched < MAX_TREE_PAGES; fetched++) {
		const res =
			page === 1
				? treeRes
				: await call(
						creds,
						`projects/${project}/repository/tree?ref=${encodeURIComponent(branch)}&per_page=100&page=${page}`,
						{ method: "GET" },
					)
		if (!res.ok) break
		const entries = TreeEntryList.parse(await res.json())
		if (entries.length === 0) break
		for (const entry of entries) if (entry.type === "blob") existing.set(entry.path, entry.path)
		// GitLab signals another page with `x-next-page`; an empty one ends it.
		const next = res.headers.get("x-next-page")
		if (!next) break
		const nextPage = Number(next)
		// A header that is not a number, or that does not move forward, would walk the same page for ever. GitLab's own value is the page after this one.
		if (!Number.isFinite(nextPage) || nextPage <= page) break
		page = nextPage
	}

	const actions: (
		| { action: "create" | "update"; file_path: string; content: string }
		| { action: "delete"; file_path: string }
	)[] = []
	const written: WrittenFile[] = []

	// Read each candidate file's current content to decide no-op vs update.
	await Promise.all(
		files.map(async file => {
			// A deletion needs no raw read: the tree listing is the whole answer. Absent means nothing to do; present means a delete action.
			if (file.content === null) {
				if (!existing.has(file.path)) {
					written.push({ bytes: 0, path: file.path, sha: "", unchanged: true })
					return
				}
				actions.push({ action: "delete", file_path: file.path })
				written.push({ bytes: 0, path: file.path, sha: "", unchanged: false })
				return
			}
			const path = encodeURIComponent(file.path)
			const res = await call(
				creds,
				`projects/${project}/repository/files/${path}/raw?ref=${encodeURIComponent(branch)}`,
				{
					method: "GET",
				},
			)
			// A 404 is "not there yet", which is a create. Anything else non-ok is a real problem and is left for the commit to surface.
			const present = res.status !== 404
			const current = present && res.ok ? await res.text() : null

			if (present && current === file.content) {
				written.push({ bytes: byteLength(file.content), path: file.path, sha: "", unchanged: true })
				return
			}
			// The tree listing is the authority on create-vs-update; the raw read is only for the no-op check. A file the tree did not list is a create even if the raw read happened to answer.
			const isNew = !existing.has(file.path)
			actions.push({
				action: isNew ? "create" : "update",
				content: file.content,
				file_path: file.path,
			})
			written.push({ bytes: byteLength(file.content), path: file.path, sha: "", unchanged: false })
		}),
	)

	if (actions.length === 0) return written.toSorted((a, b) => a.path.localeCompare(b.path))

	const commitRes = await call(creds, `projects/${project}/repository/commits`, {
		body: JSON.stringify({ actions, branch, commit_message: message }),
		headers: { "content-type": "application/json" },
		method: "POST",
	})
	// GitLab answers 409 when the branch moved under us, which is the same finding as GitHub's 422 on a non-fast-forward ref update.
	if (commitRes.status === 409)
		throw new HttpError("CONFLICT", "The repo moved while syncing. Nothing was written; try again.")
	if (!commitRes.ok) await throwForgeError(creds.forge, commitRes)
	const commit = GitLabCommitBody.parse(await commitRes.json())

	// GitLab's commit response carries the commit sha, not per-file shas, so the run history records that per file. It is what a maker would look up anyway.
	return written
		.map(w => Object.assign({}, w, { sha: w.unchanged ? w.sha : commit.id }))
		.toSorted((a, b) => a.path.localeCompare(b.path))
}
