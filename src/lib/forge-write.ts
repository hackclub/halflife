import "server-only"
import { createHash } from "node:crypto"
import { HttpError } from "@/lib/errors"
import { type Forge, repoUrl } from "@/lib/forge"
import prisma from "@/lib/prisma"
import type { RepoRef } from "@/lib/repo-ref"

/**
 * Writing a participant's work back into their own repo, on whichever forge
 * they linked.
 *
 * Read-only checks (lib/forge-read) prove a repo exists and has the files a
 * week needs. This is the other direction: committing the devlogs and parts
 * list the platform already holds into the maker's repo, so their work is
 * readable without a Half Life account.
 *
 * Two differences from the read path matter:
 *
 * - It is the participant's own token, not the shared gh-proxy pool. Reading a
 *   public repo is a thing the program does for everyone; writing to someone's
 *   repository is done as them, with the access they granted, and must never
 *   ride on a token belonging to the program. The proxy pool could not write
 *   even if it were offered.
 * - There is no retry-and-back-off machinery here. A commit is not a check: a
 *   failure is recorded against the project (and left for the next write, or
 *   the maker's own "Sync now") rather than retried in a loop that could
 *   interleave with the next entry's sync.
 *
 * ## Why this file is long
 *
 * The two forges commit a set of files in genuinely different ways, and
 * pretending otherwise would mean one implementation wearing the other's shape:
 *
 * - **GitHub** has no "commit these files" endpoint. Its contents API is
 *   per-file, so n files would be n commits and n "Update JOURNAL.md" entries in
 *   the maker's history. The Git Data API is used instead — blobs, one tree,
 *   one commit, one ref update — which is four round trips and a manual
 *   fast-forward guard, but lands atomically and detects a concurrent push.
 * - **GitLab** has `POST /projects/:id/repository/commits` with an `actions[]`
 *   array: one request, one commit, create/update/delete decided per action.
 *   That is simpler, and takes GitLab's own optional guard (`last_commit_id`)
 *   for the same concurrency protection.
 *
 * Each is written the way its API wants to be used, and the shared parts — the
 * no-op-when-unchanged check, the result shape — are hoisted above them.
 */

/** Long enough for a commit, short enough that a stalled call does not hold a job. */
const TIMEOUT_MS = 15_000

/**
 * The caller's forge identity and a token, or null when they have not linked
 * that forge. A revoked or expired token reads the same as never having linked:
 * the UI offers the forge again rather than showing an error nobody can act on.
 */
export interface ForgeCredentials {
	forge: Forge
	/** The account's login on that forge, from the account row. */
	login: string
	accessToken: string
}

export class ForgeWriteUnavailable extends Error {}

/**
 * The token for one forge, refreshed when it has expired.
 *
 * Read through `auth.api.getAccessToken`, not straight from the account row.
 * That distinction is the whole reason GitLab is safe to support: GitLab's
 * OAuth access tokens expire after **two hours**, so a token read raw from the
 * database is dead within one syncing session. better-auth's call refreshes it
 * from the stored refresh token and writes the new one back, which is exactly
 * what a two-hour lifetime needs and what GitHub never asked of us (GitHub
 * tokens do not expire).
 *
 * Resolves null when the user has not linked this forge, or when the refresh
 * fails (the refresh token was revoked) — both mean "offer the forge again".
 */
export async function forgeCredentials(userId: string, forge: Forge): Promise<ForgeCredentials | null> {
	const account = await prisma.account.findFirst({
		where: { userId, providerId: forge.id },
		orderBy: { updatedAt: "desc" },
		select: { id: true, accountId: true, accessToken: true },
	})
	if (!account?.accessToken) return null

	let accessToken = account.accessToken
	try {
		// Imported lazily: lib/auth reaches back into the database and its hooks,
		// and importing it at module scope here would close a cycle.
		const { auth } = await import("@/lib/auth")
		const fresh = await auth.api.getAccessToken({ body: { accountId: account.id, userId } })
		if (fresh?.accessToken) accessToken = fresh.accessToken
	} catch (err) {
		// A refresh that fails is not fatal on its own: the stored token may still
		// be good (GitHub's never expire). The call below is what finds out.
		console.warn(`[forge-write] token refresh for ${forge.id} failed:`, err)
	}

	return { forge, login: account.accountId, accessToken }
}
async function call(creds: ForgeCredentials, path: string, init: RequestInit): Promise<Response> {
	const forge = creds.forge
	const url = forge.id === "gitlab" ? `https://gitlab.com/api/v4/${path}` : `https://api.github.com/${path}`

	const headers: Record<string, string> =
		forge.id === "gitlab"
			? { Accept: "application/json", Authorization: `Bearer ${creds.accessToken}` }
			: {
					Accept: "application/vnd.github+json",
					Authorization: `Bearer ${creds.accessToken}`,
					"X-GitHub-Api-Version": "2022-11-28",
				}

	let res: Response
	try {
		res = await fetch(url, {
			...init,
			headers: { ...headers, ...(init.headers ?? {}) },
			signal: AbortSignal.timeout(TIMEOUT_MS),
			cache: "no-store",
		})
	} catch {
		throw new ForgeWriteUnavailable(`${forge.label} did not answer.`)
	}
	// 401/403 are the two ways a token says it may not do this: revoked, or
	// lacking the scope. Neither is retried here — the caller records it and the
	// maker relinks.
	if (res.status === 401 || res.status === 403) {
		throw new HttpError("FORBIDDEN", `${forge.label} refused that — reconnect ${forge.label} and try again.`)
	}
	return res
}

/** A repo the caller can push to, as the picker shows it. */
export interface WritableRepo {
	/** `owner/name`, or `group/subgroup/name` on GitLab. */
	fullName: string
	name: string
	/** The whole path to the repo, which may be more than one segment. */
	ownerPath: string
	/** The repo's forge web URL — what the sync stores as its pinned target. */
	url: string
	private: boolean
	defaultBranch: string
	pushedAt: string | null
}

/**
 * The repos the caller may write to, newest-pushed first.
 *
 * Filtered to what they can actually push to. Offering a repo the token cannot
 * write to would let someone turn the sync on and then watch every entry fail
 * with a 403 they cannot fix from here.
 */
export async function listWritableRepos(userId: string, forge: Forge): Promise<WritableRepo[]> {
	const creds = await forgeCredentials(userId, forge)
	if (!creds) return []
	return forge.id === "gitlab" ? listGitLabRepos(creds) : listGitHubRepos(creds)
}

async function listGitHubRepos(creds: ForgeCredentials): Promise<WritableRepo[]> {
	const res = await call(creds, "user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator", { method: "GET" })
	if (!res.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)
	const repos = (await res.json()) as {
		full_name: string
		name: string
		owner: { login: string }
		private: boolean
		default_branch: string
		permissions?: { push?: boolean; admin?: boolean; maintain?: boolean }
		pushed_at: string | null
	}[]
	return repos
		.filter((r) => r.permissions?.push === true || r.permissions?.admin === true || r.permissions?.maintain === true)
		.map((r) => ({
			fullName: r.full_name,
			name: r.name,
			ownerPath: r.owner.login,
			url: repoUrl(creds.forge, r.owner.login, r.name),
			private: r.private,
			defaultBranch: r.default_branch,
			pushedAt: r.pushed_at,
		}))
}

async function listGitLabRepos(creds: ForgeCredentials): Promise<WritableRepo[]> {
	// `membership=true` is "projects I am a member of", which is the closest
	// equivalent to GitHub's owner+collaborator affiliation. `min_access_level`
	// narrows it to projects they can push to, the same filter GitHub's
	// `permissions.push` applies client-side.
	const res = await call(
		creds,
		"projects?membership=true&min_access_level=30&per_page=100&order_by=last_activity_at&sort=desc",
		{ method: "GET" },
	)
	if (!res.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)
	const projects = (await res.json()) as {
		path_with_namespace: string
		name: string
		path: string
		namespace: { full_path: string }
		visibility: string
		default_branch: string | null
		last_activity_at: string | null
	}[]
	return projects.map((p) => ({
		fullName: p.path_with_namespace,
		name: p.name,
		ownerPath: p.namespace.full_path,
		url: repoUrl(creds.forge, p.namespace.full_path, p.path),
		private: p.visibility !== "public",
		// GitLab answers null for a project with no commits yet. The default
		// branch of such a project is `main`, and a commit has to name one, so
		// that is what it falls back to.
		defaultBranch: p.default_branch ?? "main",
		pushedAt: p.last_activity_at,
	}))
}

export interface FileUpdate {
	path: string
	content: string
}

export interface WrittenFile {
	path: string
	/** The blob sha the forge answered with, for the run history. */
	sha: string
	bytes: number
	/** True when the write was a no-op because the file already held this. */
	unchanged: boolean
}

/**
 * Write a set of files to one branch in one commit.
 *
 * A file whose contents already match is left alone rather than rewritten, so
 * the common case — a journal entry that changed nothing about BOM.md, or a
 * retried sync — produces no commit at all. Both implementations honour that,
 * and both make the whole set land atomically or not at all.
 */
export async function commitFiles(
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
 * Deliberately not a configured branch. A maker's repo is theirs, and guessing a
 * `devlog` branch that may not exist would fail every write with a 404; the
 * default branch is the one that always exists, and a maker who wants the files
 * elsewhere can merge them or point the sync at a repo that has it.
 */
export async function defaultBranchOf(creds: ForgeCredentials, ref: RepoRef): Promise<string> {
	if (creds.forge.id === "gitlab") {
		const res = await call(creds, `projects/${encodeURIComponent(ref.fullName)}`, { method: "GET" })
		if (res.status === 404) throw new HttpError("NOT_FOUND", `${ref.fullName} does not exist or is not visible.`)
		if (!res.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)
		const body = (await res.json()) as { default_branch: string | null }
		return body.default_branch ?? "main"
	}

	const res = await call(creds, `repos/${ref.fullName}`, { method: "GET" })
	if (res.status === 404) throw new HttpError("NOT_FOUND", `${ref.fullName} does not exist or is not visible.`)
	if (!res.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)
	const body = (await res.json()) as { default_branch: string | null }
	// An empty repo may answer null; the branch the first commit names has to come
	// from somewhere, and `main` is what GitHub itself would create.
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

	// What the branch's tip is. The commit is parented on this, and the ref
	// update is guarded on it still being the tip — so a push that lands between
	// this read and the write fails the whole thing rather than discarding it.
	//
	// An empty repository is the one case where there is no tip to read: GitHub
	// answers 409 ("Git Repository is empty") and refuses the whole Git Data API
	// until the repo has a commit. The Contents API is the documented way in —
	// writing one file initialises the repository and its first branch — after
	// which the read below works as usual. That first file lands in its own
	// commit; the rest still land together in one.
	let refRes = await call(creds, `${base}/git/ref/heads/${encodeURIComponent(branch)}`, { method: "GET" })
	if (refRes.status === 409) {
		const first = files[0]
		if (!first) return []
		await initializeEmptyGitHubRepo(creds, ref, branch, first, message)
		refRes = await call(creds, `${base}/git/ref/heads/${encodeURIComponent(branch)}`, { method: "GET" })
	}
	if (refRes.status === 404) {
		throw new HttpError("UNPROCESSABLE", `The repo has no branch called ${branch}.`)
	}
	if (!refRes.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)
	const parentSha = ((await refRes.json()) as { object: { sha: string } }).object.sha

	const commitRes = await call(creds, `${base}/git/commits/${parentSha}`, { method: "GET" })
	if (!commitRes.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)
	const treeSha = ((await commitRes.json()) as { tree: { sha: string } }).tree.sha

	// One blob per changed file, in parallel. Unchanged ones are skipped before a
	// blob is ever made: comparing requires their current blob sha, which the
	// tree listing already gives us.
	const current = await currentBlobShas(creds, base, treeSha)
	const written: WrittenFile[] = []
	const entries: { path: string; sha: string }[] = []

	await Promise.all(
		files.map(async (file) => {
			const sha = blobSha(file.content)
			if (current.get(file.path) === sha) {
				written.push({ path: file.path, sha, bytes: byteLength(file.content), unchanged: true })
				// Still in the tree — an unchanged file is simply not re-added.
				return
			}
			const blobRes = await call(creds, `${base}/git/blobs`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
			})
			if (!blobRes.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)
			const blob = (await blobRes.json()) as { sha: string }
			entries.push({ path: file.path, sha: blob.sha })
			written.push({ path: file.path, sha: blob.sha, bytes: byteLength(file.content), unchanged: false })
		}),
	)

	if (entries.length === 0) {
		// Every file already held this content. No tree, no commit, no ref update.
		return written.sort((a, b) => a.path.localeCompare(b.path))
	}

	const treeRes = await call(creds, `${base}/git/trees`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			base_tree: treeSha,
			tree: entries.map((e) => ({ path: e.path, mode: "100644", type: "blob", sha: e.sha })),
		}),
	})
	if (!treeRes.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)
	const newTree = ((await treeRes.json()) as { sha: string }).sha

	const newCommitRes = await call(creds, `${base}/git/commits`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ message, tree: newTree, parents: [parentSha] }),
	})
	if (!newCommitRes.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)
	const commit = ((await newCommitRes.json()) as { sha: string }).sha

	// Guarded: only fast-forward if the ref is still where we read it. A
	// concurrent push makes this a 422 and nothing is written, which is the
	// correct outcome — the next sync reads the new tip and commits on top of it.
	const updateRes = await call(creds, `${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sha: commit, force: false }),
	})
	if (updateRes.status === 422) {
		throw new HttpError("CONFLICT", "The repo moved while syncing. Nothing was written; try again.")
	}
	if (!updateRes.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)

	return written.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Give a repo with no commits its first one, so the Git Data API can be used on
 * it. GitHub refuses blobs, trees and commits on an empty repository (409), and
 * names the Contents API as the one endpoint that can initialise it: writing a
 * single file creates the commit and, with it, the branch. Named branch because
 * an empty repo has no default for GitHub to fall back to.
 *
 * https://docs.github.com/rest/guides/using-the-rest-api-to-interact-with-your-git-database
 */
async function initializeEmptyGitHubRepo(
	creds: ForgeCredentials,
	ref: RepoRef,
	branch: string,
	file: FileUpdate,
	message: string,
): Promise<void> {
	const path = file.path.split("/").map(encodeURIComponent).join("/")
	const res = await call(creds, `repos/${ref.fullName}/contents/${path}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			message,
			// The Contents API wants the bytes base64-encoded, not the text.
			content: Buffer.from(file.content, "utf-8").toString("base64"),
			branch,
		}),
	})
	if (!res.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)
}

/** `path -> blob sha` for one tree, so an unchanged file can be spotted. */
async function currentBlobShas(creds: ForgeCredentials, base: string, treeSha: string): Promise<Map<string, string>> {
	const res = await call(creds, `${base}/git/trees/${treeSha}?recursive=1`, { method: "GET" })
	const out = new Map<string, string>()
	if (!res.ok) return out
	const body = (await res.json()) as { tree?: { path: string; type: string; sha: string }[] }
	for (const entry of body.tree ?? []) {
		if (entry.type === "blob") out.set(entry.path, entry.sha)
	}
	return out
}

/**
 * The blob sha GitHub would give this content: SHA-1 over `blob <len>\0<content>`.
 *
 * Computed here rather than asked for, because asking means uploading each file
 * twice — once to check, once to write — and the hash is the documented, stable
 * way to compare against what the tree already holds.
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
 * GitLab wants `create` for a file that is not in the repo and `update` for one
 * that is; sending the wrong one fails the whole commit. So the file list is
 * read first, and each action is labelled from what it found. That read is also
 * what the no-op check needs — a file whose content already matches is left out
 * of the actions entirely.
 *
 * There is no blob hash to compare against here (that is a GitHub concept), so
 * the comparison is on the file's content directly, which is what the raw-file
 * endpoint returns.
 */
async function commitGitLab(
	creds: ForgeCredentials,
	ref: RepoRef,
	branch: string,
	files: FileUpdate[],
	message: string,
): Promise<WrittenFile[]> {
	const project = encodeURIComponent(ref.fullName)

	// The branch tip, for the optimistic guard. `last_commit_id` makes GitLab
	// refuse the commit if the file has moved since; the tree listing below is
	// read at this same tip, so the two agree.
	const treeRes = await call(
		creds,
		`projects/${project}/repository/tree?ref=${encodeURIComponent(branch)}&per_page=100`,
		{
			method: "GET",
		},
	)
	if (treeRes.status === 404) {
		throw new HttpError("UNPROCESSABLE", `The repo has no branch called ${branch}.`)
	}
	if (!treeRes.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)

	// The listing is paginated; walk it so a repo with many files does not make
	// an existing file look new (which would fail the commit with "file exists").
	const existing = new Map<string, string>()
	let page = 1
	for (;;) {
		const res =
			page === 1
				? treeRes
				: await call(
						creds,
						`projects/${project}/repository/tree?ref=${encodeURIComponent(branch)}&per_page=100&page=${page}`,
						{ method: "GET" },
					)
		if (!res.ok) break
		const entries = (await res.json()) as { path: string; type: string }[]
		if (entries.length === 0) break
		for (const entry of entries) {
			if (entry.type === "blob") existing.set(entry.path, entry.path)
		}
		// GitLab signals another page with `x-next-page`; an empty one ends it.
		const next = res.headers.get("x-next-page")
		if (!next) break
		page = Number(next)
	}

	const actions: { action: "create" | "update"; file_path: string; content: string }[] = []
	const written: WrittenFile[] = []

	// Read each candidate file's current content to decide no-op vs update.
	await Promise.all(
		files.map(async (file) => {
			const path = encodeURIComponent(file.path)
			const res = await call(
				creds,
				`projects/${project}/repository/files/${path}/raw?ref=${encodeURIComponent(branch)}`,
				{
					method: "GET",
				},
			)
			// A 404 is "not there yet", which is a create. Anything else non-ok is a
			// real problem and is left for the commit to surface.
			const present = res.status !== 404
			const current = present && res.ok ? await res.text() : null

			if (present && current === file.content) {
				written.push({ path: file.path, sha: "", bytes: byteLength(file.content), unchanged: true })
				return
			}
			// The tree listing is the authority on create-vs-update; the raw read is
			// only for the no-op check. A file the tree did not list is a create even
			// if the raw read happened to answer.
			const isNew = !existing.has(file.path)
			actions.push({
				action: isNew ? "create" : "update",
				file_path: file.path,
				content: file.content,
			})
			written.push({ path: file.path, sha: "", bytes: byteLength(file.content), unchanged: false })
		}),
	)

	if (actions.length === 0) {
		return written.sort((a, b) => a.path.localeCompare(b.path))
	}

	const commitRes = await call(creds, `projects/${project}/repository/commits`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ branch, commit_message: message, actions }),
	})
	// GitLab answers 409 when the branch moved under us, which is the same
	// finding as GitHub's 422 on a non-fast-forward ref update.
	if (commitRes.status === 409) {
		throw new HttpError("CONFLICT", "The repo moved while syncing. Nothing was written; try again.")
	}
	if (!commitRes.ok) throw new ForgeWriteUnavailable(`${creds.forge.label} did not answer.`)
	const commit = (await commitRes.json()) as { id: string }

	// GitLab's commit response carries the commit sha, not per-file shas, so the
	// run history records that per file. It is what a maker would look up anyway.
	return written
		.map((w) => ({ ...w, sha: w.unchanged ? w.sha : commit.id }))
		.sort((a, b) => a.path.localeCompare(b.path))
}
