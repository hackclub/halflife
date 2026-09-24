import "server-only"
import type { Theme } from "@/app/generated/prisma/enums"
import {
  REPO_FILE_KINDS,
  THEME_REPO_REQUIREMENTS,
  type RepoFileKind,
} from "@/lib/config/repo-checks"
import { GitHubUnavailable, gh } from "@/lib/github"

/**
 * Pre-submission repo checks, ported from Hack Club Stasis (lib/github-checks).
 *
 * For the maker, not the reviewer: they say what to change in the repo before
 * handing a week in, so it is not rejected for something a script could have
 * spotted. Run from the submit sheet so the maker sees it while they can still
 * fix it, and again inside the submit itself, because a checklist rendered a
 * minute ago is not an authorisation.
 *
 * GitHub is reached through lib/github, which picks the route (gh-proxy, a
 * token, or neither) and backs off when told to. Each check costs two
 * requests — the file list and the README — and what GitHub says about a repo
 * is reused for a minute (see SNAPSHOT_TTL_MS), so one hand-in costs one fetch
 * however many times it is checked.
 *
 * GitHub being down or rate-limited is ours to absorb, not the maker's: those
 * come back `unavailable` and never block, and the reviewer checks by hand.
 * Only what the repo itself is missing blocks.
 */

export type RepoCheckStatus = "pass" | "fail" | "warn"

export interface RepoCheck {
  key: string
  label: string
  status: RepoCheckStatus
  detail?: string
  /** A failure here stops the week being handed in. */
  blocking?: boolean
}

export interface RepoCheckResult {
  repo: string | null
  checks: RepoCheck[]
  canSubmit: boolean
  /** GitHub could not be asked; nothing was concluded about the repo. */
  unavailable: boolean
  checkedAt: string
}

// Owner and repo names only ever contain these. Checking them here is the one
// chokepoint that stops a crafted URL (`github.com/a/..%2f..%2fadmin`) adding
// path segments to the API URL built below — Stasis's rule, kept as is.
const GH_SEGMENT = /^[A-Za-z0-9._-]+$/

export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null
    const [owner, rawRepo] = u.pathname.split("/").filter(Boolean)
    const repo = rawRepo?.replace(/\.git$/, "")
    if (!owner || !repo || !GH_SEGMENT.test(owner) || !GH_SEGMENT.test(repo)) return null
    return { owner, repo }
  } catch {
    return null
  }
}

/** What GitHub said about a repo — everything the checks are built from. */
type Snapshot =
  | {
      kind: "ok"
      /** Lowercased, for matching. */
      paths: string[]
      /** The same files as GitHub spells them, index for index — for links. */
      files: string[]
      readme: string | null
      /**
       * GitHub cut the file list short — it stops at about 100,000 entries —
       * so a file missing from `paths` may still be in the repo.
       */
      truncated: boolean
    }
  | { kind: "not-found" }
  | { kind: "unavailable"; why: string }

/**
 * How long one answer from GitHub is reused for a repo.
 *
 * One hand-in asks several times: the project page, the submit sheet, and the
 * submit itself, which re-checks rather than trusting the sheet. A minute is
 * short enough that a maker who has just pushed waits at most that long to see
 * it, and long enough to fold one hand-in into one fetch.
 */
const SNAPSHOT_TTL_MS = 60_000

/**
 * How long "could not check" is reused. Short, because it is usually a blip —
 * the proxy failing for a second — and holding it for the full minute told
 * makers GitHub was down long after it was back. A rate limit is not what this
 * protects against: lib/github already refuses to call while one lasts.
 */
const UNAVAILABLE_TTL_MS = 10_000

/** A bound on memory for a burst of distinct repos; expired entries go first. */
const SNAPSHOT_CACHE_MAX = 500

/**
 * Per server process, keyed by `owner/repo` lowercased — GitHub names are
 * case-insensitive, and two spellings of one repo should share one fetch. The
 * value is the promise, not the result, so concurrent checks of the same repo
 * (React's double mount in dev, a page and a sheet opening together) wait on
 * one request instead of each starting their own.
 */
const snapshots = new Map<string, { at: number; ttl: number; value: Promise<Snapshot> }>()

function snapshot(owner: string, repo: string): Promise<Snapshot> {
  const key = `${owner}/${repo}`.toLowerCase()
  const now = Date.now()
  const hit = snapshots.get(key)
  if (hit && now - hit.at < hit.ttl) return hit.value

  if (snapshots.size >= SNAPSHOT_CACHE_MAX) {
    for (const [k, v] of snapshots) {
      if (now - v.at >= v.ttl) snapshots.delete(k)
    }
    // Still full of live entries: drop the oldest. Map keeps insertion order.
    if (snapshots.size >= SNAPSHOT_CACHE_MAX) snapshots.delete(snapshots.keys().next().value!)
  }

  // Never rejects. The promise is what the cache holds, so a rejected one
  // would be handed to every check of this repo for the next minute — each of
  // them a 500 — instead of the short-lived "could not check" it should be.
  const value = fetchSnapshot(owner, repo).catch((err): Snapshot => {
    console.warn(`[repo-checks] ${owner}/${repo} failed unexpectedly:`, err)
    return { kind: "unavailable", why: "GitHub did not answer." }
  })
  const entry = { at: now, ttl: SNAPSHOT_TTL_MS, value }
  snapshots.set(key, entry)
  // Settled, a failure is only kept briefly. Checked against the entry itself,
  // so a newer fetch that has replaced it is left alone.
  void value.then((snap) => {
    if (snap.kind === "unavailable" && snapshots.get(key) === entry) entry.ttl = UNAVAILABLE_TTL_MS
  })
  return value
}

/**
 * Two requests, side by side. The file list is read at HEAD — the default
 * branch, whatever it is called — so there is no need to ask for the repo
 * first just to learn the branch name, which is what used to make this three.
 * The file list also answers whether the repo exists: 404 there means it does
 * not, or is private, which to a reviewer is the same thing.
 */
async function fetchSnapshot(owner: string, repo: string): Promise<Snapshot> {
  let treeRes: Response
  let readmeRes: Response
  try {
    ;[treeRes, readmeRes] = await Promise.all([
      gh(`repos/${owner}/${repo}/git/trees/HEAD?recursive=1`),
      gh(`repos/${owner}/${repo}/readme`),
    ])
  } catch (err) {
    return {
      kind: "unavailable",
      why: err instanceof GitHubUnavailable ? err.message : "GitHub did not answer.",
    }
  }

  if (treeRes.status === 404) return { kind: "not-found" }
  // 409 is an empty repo: no commits, so no tree. That is a real finding.
  if (!treeRes.ok && treeRes.status !== 409) {
    return { kind: "unavailable", why: `GitHub returned an error (${treeRes.status}).` }
  }
  // 404 is the only answer that means there is no README. Anything else is
  // GitHub failing to say, and blocking on that would tell the maker to add a
  // README they already have.
  if (!readmeRes.ok && readmeRes.status !== 404) {
    return { kind: "unavailable", why: `GitHub returned an error (${readmeRes.status}).` }
  }

  const body = treeRes.ok
    ? ((await treeRes.json()) as { tree?: { path: string; type: string }[]; truncated?: boolean })
    : { tree: [], truncated: false }
  const files = (body.tree ?? []).filter((f) => f.type === "blob").map((f) => f.path)
  const paths = files.map((p) => p.toLowerCase())

  let readme: string | null = null
  if (readmeRes.ok) {
    const r = (await readmeRes.json()) as { content?: string; encoding?: string }
    if (r.content && r.encoding === "base64") {
      readme = Buffer.from(r.content, "base64").toString("utf-8")
    }
  }

  return { kind: "ok", paths, files, readme, truncated: body.truncated === true }
}

/** Stasis's image test: markdown or HTML images, or an image file named in it. */
const README_IMAGE = /!\[.*?\]\(.*?\)|<img\s+[^>]*src\s*=|\.png|\.jpe?g|\.gif|\.webp|\.svg/i

function matches(kind: RepoFileKind, paths: readonly string[]): string[] {
  const def = REPO_FILE_KINDS[kind]
  return paths.filter((p) =>
    def.pattern ? def.pattern.test(p) : (def.extensions ?? []).some((ext) => p.endsWith(ext)),
  )
}

function sample(found: readonly string[]): string {
  const shown = found.slice(0, 3).map((p) => p.split("/").pop()).join(", ")
  return found.length > 3 ? `${shown} and ${found.length - 3} more` : shown
}

function result(repo: string | null, checks: RepoCheck[], unavailable = false): RepoCheckResult {
  return {
    repo,
    checks,
    canSubmit: !checks.some((c) => c.blocking && c.status === "fail"),
    unavailable,
    checkedAt: new Date().toISOString(),
  }
}

export async function checkRepo(githubRepo: string | null, theme: Theme): Promise<RepoCheckResult> {
  if (!githubRepo) {
    return result(null, [
      {
        key: "repo",
        label: "No GitHub repo yet",
        status: "fail",
        detail: "Add your project's GitHub repo so a reviewer can see the files.",
        blocking: true,
      },
    ])
  }

  const parsed = parseGitHubRepo(githubRepo)
  if (!parsed) {
    return result(githubRepo, [
      {
        key: "repo",
        label: "Not a GitHub repo link",
        status: "fail",
        detail: "Use the link to the repo itself, like github.com/you/your-project.",
        blocking: true,
      },
    ])
  }
  const { owner, repo } = parsed
  const name = `${owner}/${repo}`

  const unavailable = (why: string) =>
    result(
      githubRepo,
      [
        {
          key: "repo",
          label: "Could not check the repo",
          status: "warn",
          detail: `${why} You can still hand in; a reviewer will check the repo by hand.`,
        },
      ],
      true,
    )

  const snap = await snapshot(owner, repo)
  if (snap.kind === "unavailable") return unavailable(snap.why)
  if (snap.kind === "not-found") {
    return result(githubRepo, [
      {
        key: "repo",
        label: "Repo not found",
        status: "fail",
        detail: `${name} does not exist or is private. Make it public so a reviewer can open it.`,
        blocking: true,
      },
    ])
  }
  const { paths, readme, truncated } = snap

  const checks: RepoCheck[] = [{ key: "repo", label: "Public GitHub repo", status: "pass", detail: name }]

  checks.push(
    readme !== null
      ? { key: "readme", label: "README", status: "pass" }
      : {
          key: "readme",
          label: "README missing",
          status: "fail",
          detail: "Add a README.md saying what the project is and how it works.",
          blocking: true,
        },
  )
  checks.push(
    readme !== null && README_IMAGE.test(readme)
      ? { key: "readme_photo", label: "Photos in the README", status: "pass" }
      : {
          key: "readme_photo",
          label: "No photos in the README",
          status: "fail",
          detail: "Add at least one image of the project — a render, a screenshot of the board, or a photo.",
          blocking: true,
        },
  )

  const { required, recommended } = THEME_REPO_REQUIREMENTS[theme]
  for (const kind of required) {
    const found = matches(kind, paths)
    const def = REPO_FILE_KINDS[kind]
    checks.push(
      found.length > 0
        ? { key: kind, label: def.label, status: "pass", detail: sample(found) }
        : truncated
          ? // Not found in a list GitHub cut short is not the same as not
            // there, so it cannot block — a reviewer checks by hand instead.
            {
              key: kind,
              label: `${def.label} not found`,
              status: "warn",
              detail: `The repo is too big for GitHub to list in full, so this could not be confirmed. ${def.missing}`,
            }
          : { key: kind, label: `${def.label} missing`, status: "fail", detail: def.missing, blocking: true },
    )
  }
  for (const kind of recommended) {
    const found = matches(kind, paths)
    const def = REPO_FILE_KINDS[kind]
    checks.push(
      found.length > 0
        ? { key: kind, label: def.label, status: "pass", detail: sample(found) }
        : {
            key: kind,
            label: `${def.label} not found`,
            status: "warn",
            detail: `${def.missing}. Not required, but worth adding.`,
          },
    )
  }

  return result(githubRepo, checks)
}

/**
 * A link to the first file in the repo whose path matches, or null.
 *
 * Reads the same cached file list the checks use, so asking costs nothing
 * extra when a check has just run — which, at submit, it always has.
 * Shallowest match wins, so a root JOURNAL.md beats one in a subfolder.
 */
export async function findRepoFile(githubRepo: string | null, test: RegExp): Promise<string | null> {
  const parsed = githubRepo ? parseGitHubRepo(githubRepo) : null
  if (!parsed) return null
  const snap = await snapshot(parsed.owner, parsed.repo)
  if (snap.kind !== "ok") return null
  const hits = snap.files.filter((f) => test.test(f)).sort((a, b) => a.split("/").length - b.split("/").length)
  const hit = hits[0]
  if (!hit) return null
  const path = hit.split("/").map(encodeURIComponent).join("/")
  return `https://github.com/${parsed.owner}/${parsed.repo}/blob/HEAD/${path}`
}
