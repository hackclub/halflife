import "server-only"

/**
 * Code forges: the hosts Half Life can read a repo from and write it back to.
 *
 * A "forge" here is one web host offering git repositories over an HTTP API.
 * GitHub and GitLab are the two configured; the shape is hostname-keyed rather
 * than a two-way switch, so a third (Codeberg, a self-hosted Gitea) is an entry
 * in `FORGES` and nothing else. That was the point of building it this way: the
 * expensive part of a second forge is the refactor, not the API calls.
 *
 * Two things vary between forges and are therefore per-forge data, not
 * conditionals spread through the callers:
 *
 * - **How a repo is named in a URL.** `github.com/owner/repo` and
 *   `gitlab.com/owner/repo` agree, but GitLab supports nested groups
 *   (`gitlab.com/group/subgroup/repo`), so "owner" is not always one segment.
 * - **How a file is reached in the web UI.** `…/blob/HEAD/path` on GitHub,
 *   `…/-/blob/HEAD/path` on GitLab. A link to a maker's file has to use the
 *   right one or it 404s.
 *
 * The API surfaces are different enough that they are NOT modelled here — the
 * read path (lib/github) and the write path (lib/forge-write) each switch on
 * `id` internally, where the API shapes are visible side by side and the
 * differences can be explained. This module is only the identity layer: what a
 * host is called, how a URL maps to a repo, and what the token has to be
 * allowed to do.
 */

/** The two forges configured today. A Codeberg/Gitea entry would join them. */
export type ForgeId = "github" | "gitlab"

export interface Forge {
  id: ForgeId
  /** What the maker sees: "GitHub", "GitLab". */
  label: string
  /** The canonical web host. */
  hostname: string
  /** Hosts that mean the same forge, e.g. GitHub's `www.` prefix. */
  aliases: readonly string[]
  /** One extra web path segment between the repo and `blob`, e.g. GitLab's `-`. */
  blobSegment: string
  /**
   * Whether a repo path may carry nested groups (`group/sub/repo`), which
   * GitLab allows and GitHub does not. The repo parser uses this to decide how
   * many segments are a repo and how many are the path to it.
   */
  nestedGroups: boolean
  /**
   * The OAuth scopes this forge needs to read private repos and push to one.
   * GitHub has one broad `repo` scope; GitLab splits read from write and grants
   * API access separately.
   */
  scopes: readonly string[]
  /** Where the forge's OAuth app is created, for the "make one" link. */
  newAppUrl: string
}

export const FORGES: Record<ForgeId, Forge> = {
  github: {
    id: "github",
    label: "GitHub",
    hostname: "github.com",
    aliases: ["www.github.com"],
    blobSegment: "blob",
    nestedGroups: false,
    // `repo` rather than `public_repo`: a maker's project repo may be private,
    // and the difference only shows up the first day someone links a private
    // repo and every write 403s. `read:user` is what lets the picker read their
    // login.
    scopes: ["read:user", "repo"],
    newAppUrl: "https://github.com/settings/applications/new",
  },
  gitlab: {
    id: "gitlab",
    label: "GitLab",
    hostname: "gitlab.com",
    aliases: ["www.gitlab.com"],
    blobSegment: "-/blob",
    nestedGroups: true,
    // `api` covers reading a repo's files AND creating a commit through the
    // Commits API, which `write_repository` alone does not (that is Git-over-
    // HTTP only — the docs are explicit that it is "not using the API").
    // `read_user` is the picker's equivalent of GitHub's `read:user`.
    //
    // `api` is broad — it is read/write over every project the person can see.
    // GitLab offers nothing narrower that still covers "commit to an arbitrary
    // project the maker names", so this is asked for at link time and explained
    // in the picker, exactly as GitHub's `repo` scope is.
    scopes: ["api", "read_user"],
    newAppUrl: "https://gitlab.com/-/user_settings/applications",
  },
}

/** Every configured forge, in a stable order. */
export const ALL_FORGES: readonly Forge[] = [FORGES.github, FORGES.gitlab]

/** The forge a hostname belongs to, or null when it is not one we speak. */
export function forgeByHostname(hostname: string): Forge | null {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
  for (const forge of ALL_FORGES) {
    if (forge.hostname === host) return forge
    if (forge.aliases.some((a) => a.replace(/^www\./, "") === host)) return forge
  }
  return null
}

/** The forge with this id, or null. Narrowing helper for stored values. */
export function forgeById(id: string): Forge | null {
  return (FORGES as Record<string, Forge | undefined>)[id] ?? null
}

/**
 * The forge a repo URL belongs to, or null for a host we do not speak.
 *
 * Callers that must accept any link (a project's `githubRepo` is allowed to be
 * a Codeberg URL, and is worth keeping) use `forgeFromRepoUrlOrNull`;
 * callers that need to *do* something with the repo (read it, write to it)
 * have to refuse anything this returns null for.
 */
export function forgeFromRepoUrlOrNull(url: string | null | undefined): Forge | null {
  if (!url) return null
  return forgeByHostname(hostnameOf(url) ?? "")
}

/** `https://github.com/a/b` → `github.com`. Null when the value will not parse. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * The web URL for one file in a repo, at HEAD.
 *
 * Uses the forge's own path shape, because GitLab puts a `-` between the repo
 * and `blob` and a link built the GitHub way lands on GitLab's 404.
 */
export function fileUrl(forge: Forge, ownerPath: string, repo: string, path: string): string {
  return `https://${forge.hostname}/${ownerPath}/${repo}/${forge.blobSegment}/HEAD/${path}`
}

/** The web URL of the repo itself. */
export function repoUrl(forge: Forge, ownerPath: string, repo: string): string {
  return `https://${forge.hostname}/${ownerPath}/${repo}`
}
