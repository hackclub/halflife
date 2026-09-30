import "server-only"
import { createHash } from "node:crypto"
import { HttpError } from "@/lib/errors"
import prisma from "@/lib/prisma"

/**
 * Writing a participant's work back into their own GitHub repository.
 *
 * Read-only checks (lib/github, lib/repo-checks) prove a repo exists and has
 * the files a week needs. This is the other direction: committing the devlogs
 * and parts list the platform already holds into the maker's repo, so their
 * work is readable without a Half Life account.
 *
 * Two differences from lib/github matter:
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
 */

const API = "https://api.github.com"

/** Long enough for a commit, short enough that a stalled call does not hold a job. */
const TIMEOUT_MS = 15_000

/** The scopes `linkGitHub` asks for. `repo` covers write to public AND private
 * repos; `public_repo` alone would silently fail for a private project, which
 * is exactly the case a maker is most likely to care about. */
export const GITHUB_SCOPES = ["read:user", "repo"]

export interface GitHubCredentials {
  /** The GitHub login, from the account row. */
  login: string
  accessToken: string
}

export class GitHubWriteUnavailable extends Error {}

/**
 * The caller's GitHub identity and a token, or null when they have not linked
 * one. A revoked or expired token reads the same as never having linked: the
 * UI offers GitHub again rather than showing an error nobody can act on.
 *
 * Unlike Lapse, GitHub tokens do not expire on their own (the token has no
 * expiry unless the OAuth app does refresh-token rotation), so there is no
 * expiry column to check — a 401 from GitHub is the signal, and it clears the
 * link when it happens.
 */
export async function githubCredentials(userId: string): Promise<GitHubCredentials | null> {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "github" },
    orderBy: { updatedAt: "desc" },
    select: { accountId: true, accessToken: true },
  })
  if (!account?.accessToken) return null
  return { login: account.accountId, accessToken: account.accessToken }
}

async function call(accessToken: string, path: string, init: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${API}/${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    })
  } catch {
    throw new GitHubWriteUnavailable("GitHub did not answer.")
  }
  // 401/403 are the two ways a token says it may not do this: revoked, or
  // lacking the scope. Neither is retried here — the caller records it and the
  // maker relinks.
  if (res.status === 401 || res.status === 403) {
    throw new HttpError("FORBIDDEN", "GitHub refused that — reconnect GitHub and try again.")
  }
  return res
}

/** A repo the caller can push to, as the picker shows it. */
export interface WritableRepo {
  fullName: string
  name: string
  owner: string
  private: boolean
  defaultBranch: string
  pushedAt: string | null
}

interface GhRepo {
  full_name: string
  name: string
  owner: { login: string }
  private: boolean
  default_branch: string
  permissions?: { push?: boolean; admin?: boolean; maintain?: boolean }
  pushed_at: string | null
}

/**
 * The repos the caller may write to, newest-pushed first.
 *
 * Filtered to what they can actually push to. Offering a repo the token cannot
 * write to would let someone turn the sync on and then watch every entry fail
 * with a 403 they cannot fix from here.
 */
export async function listWritableRepos(userId: string): Promise<WritableRepo[]> {
  const creds = await githubCredentials(userId)
  if (!creds) return []

  // `affiliation=owner,collaborator` covers their own repos and ones they were
  // added to; `per_page=100` is the max, and one page is plenty for a picker.
  const res = await call(creds.accessToken, "user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator", {
    method: "GET",
  })
  if (!res.ok) throw new GitHubWriteUnavailable("GitHub did not answer.")
  const repos = (await res.json()) as GhRepo[]
  return repos
    .filter((r) => r.permissions?.push === true || r.permissions?.admin === true || r.permissions?.maintain === true)
    .map((r) => ({
      fullName: r.full_name,
      name: r.name,
      owner: r.owner.login,
      private: r.private,
      defaultBranch: r.default_branch,
      pushedAt: r.pushed_at,
    }))
}

export interface FileUpdate {
  path: string
  content: string
}

export interface WrittenFile {
  path: string
  /** The blob sha GitHub answered with, for the run history. */
  sha: string
  bytes: number
  /** True when the write was a no-op because the file already held this. */
  unchanged: boolean
}

/**
 * Write a set of files to one branch in one commit.
 *
 * GitHub's contents API is per-file, so n files would be n commits and n
 * "Update JOURNAL.md" entries in the repo's history — the thing a maker would
 * notice first. The Git data API is used instead: blobs, one tree, one commit,
 * one ref update. The whole set lands atomically or not at all.
 *
 * A file whose contents already match is left alone rather than rewritten, so
 * the common case — a journal entry that changed nothing about BOM.md, or a
 * retried sync — produces no commit at all.
 */
export async function commitFiles(
  creds: GitHubCredentials,
  owner: string,
  repo: string,
  branch: string,
  files: FileUpdate[],
  message: string,
): Promise<WrittenFile[]> {
  // What the branch's tip is. The commit is parented on this, and the ref
  // update is guarded on it still being the tip — so a push that lands between
  // this read and the write fails the whole thing rather than discarding it.
  const refRes = await call(creds.accessToken, `repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
    method: "GET",
  })
  if (refRes.status === 404) {
    throw new HttpError("UNPROCESSABLE", `The repo has no branch called ${branch}.`)
  }
  if (!refRes.ok) throw new GitHubWriteUnavailable("GitHub did not answer.")
  const ref = (await refRes.json()) as { object: { sha: string } }
  const parentSha = ref.object.sha

  const commitRes = await call(creds.accessToken, `repos/${owner}/${repo}/git/commits/${parentSha}`, { method: "GET" })
  if (!commitRes.ok) throw new GitHubWriteUnavailable("GitHub did not answer.")
  const parent = (await commitRes.json()) as { tree: { sha: string } }

  // One blob per changed file, in parallel. Unchanged ones are skipped before a
  // blob is ever made: comparing requires their current blob sha, which the
  // tree listing already gives us.
  const current = await currentBlobShas(creds, owner, repo, parent.tree.sha)
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
      const blobRes = await call(creds.accessToken, `repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
      })
      if (!blobRes.ok) throw new GitHubWriteUnavailable("GitHub did not answer.")
      const blob = (await blobRes.json()) as { sha: string }
      entries.push({ path: file.path, sha: blob.sha })
      written.push({ path: file.path, sha: blob.sha, bytes: byteLength(file.content), unchanged: false })
    }),
  )

  if (entries.length === 0) {
    // Every file already held this content. No tree, no commit, no ref update.
    return written.sort((a, b) => a.path.localeCompare(b.path))
  }

  const treeRes = await call(creds.accessToken, `repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      base_tree: parent.tree.sha,
      tree: entries.map((e) => ({ path: e.path, mode: "100644", type: "blob", sha: e.sha })),
    }),
  })
  if (!treeRes.ok) throw new GitHubWriteUnavailable("GitHub did not answer.")
  const tree = (await treeRes.json()) as { sha: string }

  const newCommitRes = await call(creds.accessToken, `repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
  })
  if (!newCommitRes.ok) throw new GitHubWriteUnavailable("GitHub did not answer.")
  const commit = (await newCommitRes.json()) as { sha: string }

  // Guarded: only fast-forward if the ref is still where we read it. A
  // concurrent push makes this a 422 and nothing is written, which is the
  // correct outcome — the next sync reads the new tip and commits on top of it.
  const updateRes = await call(creds.accessToken, `repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sha: commit.sha, force: false }),
  })
  if (updateRes.status === 422) {
    throw new HttpError("CONFLICT", "The repo moved while syncing. Nothing was written; try again.")
  }
  if (!updateRes.ok) throw new GitHubWriteUnavailable("GitHub did not answer.")

  return written.sort((a, b) => a.path.localeCompare(b.path))
}

/** `path -> blob sha` for one tree, so an unchanged file can be spotted. */
async function currentBlobShas(
  creds: GitHubCredentials,
  owner: string,
  repo: string,
  treeSha: string,
): Promise<Map<string, string>> {
  const res = await call(creds.accessToken, `repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, { method: "GET" })
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

/**
 * The branch to write to: the repo's default branch.
 *
 * Deliberately not a configured branch. A maker's repo is theirs, and guessing a
 * `devlog` branch that may not exist would fail every write with a 404; the
 * default branch is the one that always exists, and a maker who wants the files
 * elsewhere can merge them or point the sync at a repo that has it.
 */
export async function defaultBranchOf(creds: GitHubCredentials, owner: string, repo: string): Promise<string> {
  const res = await call(creds.accessToken, `repos/${owner}/${repo}`, { method: "GET" })
  if (res.status === 404) throw new HttpError("NOT_FOUND", `${owner}/${repo} does not exist or is not visible.`)
  if (!res.ok) throw new GitHubWriteUnavailable("GitHub did not answer.")
  const body = (await res.json()) as { default_branch: string }
  return body.default_branch
}
