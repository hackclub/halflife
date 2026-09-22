import "server-only"
import type { Theme } from "@/app/generated/prisma/enums"
import {
  REPO_FILE_KINDS,
  THEME_REPO_REQUIREMENTS,
  type RepoFileKind,
} from "@/lib/config/repo-checks"

/**
 * Pre-submission repo checks, ported from Hack Club Stasis (lib/github-checks).
 *
 * Run twice: from the submit sheet so the maker sees what is missing while
 * they can still fix it, and again inside the submit itself, because a
 * checklist rendered a minute ago is not an authorisation. The second run is
 * frozen onto the submission so the reviewer sees what the repo held when it
 * was handed in.
 *
 * GitHub is reached through Hack Club's gh-proxy when GH_PROXY_API_KEY is set
 * (as Stasis does), else the GitHub API with GITHUB_TOKEN, else the GitHub API
 * unauthenticated — fine for a dev machine, 60 requests an hour in production.
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

const TIMEOUT_MS = 10_000

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

async function gh(path: string): Promise<Response> {
  const proxyKey = process.env.GH_PROXY_API_KEY
  const token = process.env.GITHUB_TOKEN
  const url = proxyKey
    ? `https://gh-proxy.hackclub.com/gh/${path}`
    : `https://api.github.com/${path}`
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
  if (proxyKey) headers["X-API-Key"] = proxyKey
  else if (token) headers.Authorization = `Bearer ${token}`
  return fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) })
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

  let repoRes: Response
  try {
    repoRes = await gh(`repos/${owner}/${repo}`)
  } catch {
    return unavailable("GitHub did not answer.")
  }
  if (repoRes.status === 404) {
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
  if (!repoRes.ok) {
    return unavailable(
      repoRes.status === 403 || repoRes.status === 429
        ? "GitHub is rate-limiting us right now."
        : `GitHub returned an error (${repoRes.status}).`,
    )
  }

  const meta = (await repoRes.json()) as { default_branch?: string; private?: boolean }
  const branch = meta.default_branch || "main"

  let treeRes: Response
  let readmeRes: Response
  try {
    ;[treeRes, readmeRes] = await Promise.all([
      gh(`repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`),
      gh(`repos/${owner}/${repo}/readme`),
    ])
  } catch {
    return unavailable("GitHub stopped answering partway through.")
  }
  if (!treeRes.ok && treeRes.status !== 404 && treeRes.status !== 409) {
    return unavailable(`GitHub returned an error (${treeRes.status}).`)
  }

  // 409 is an empty repo: no commits, so no tree. That is a real finding.
  const tree = treeRes.ok
    ? (((await treeRes.json()) as { tree?: { path: string; type: string }[] }).tree ?? [])
    : []
  const paths = tree.filter((f) => f.type === "blob").map((f) => f.path.toLowerCase())

  let readme: string | null = null
  if (readmeRes.ok) {
    const body = (await readmeRes.json()) as { content?: string; encoding?: string }
    if (body.content && body.encoding === "base64") {
      readme = Buffer.from(body.content, "base64").toString("utf-8")
    }
  }

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
