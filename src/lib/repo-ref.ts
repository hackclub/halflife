import "server-only"
import { type Forge, forgeFromRepoUrlOrNull } from "@/lib/forge"

/**
 * A repo reference: which forge it lives on, the path to it, and its name.
 *
 * This replaces what used to be `parseGitHubRepo`. Two things made a rewrite better than a second branch:
 *
 * - **Nested groups.** GitLab allows `gitlab.com/group/subgroup/repo`, so a repo is not always two path segments and "owner" is not always one. The path to the repo is kept whole as `ownerPath`; `owner` is only the last segment, for the places (a display name, a fallback label) that want one.
 *
 * - **Bare slugs.** The sync's pinned target was once `owner/name` with no host. Those still parse – against a named forge, since a host-less slug cannot say which one it means – and the caller supplies the forge it must have come from. See `parseRepoRef(value, { forge })`.
 */
export interface RepoRef {
	forge: Forge
	/** The repo without its `ownerPath`: what the API and the UI address it by. */
	fullName: string
	/** The path to the repo, whole: `owner` or `group/subgroup`. */
	ownerPath: string
	/** The repo's own name, the last segment. */
	repo: string
}

// A path segment only ever contains these. Checking them here is the one chokepoint that stops a crafted URL (`github.com/a/..%2f..%2fadmin`) adding path segments to an API URL built from this – Stasis's rule, kept as is.
const SEGMENT = /^[A-Za-z0-9._-]+$/

/** `.git` is a clone suffix, not part of the name. */
function stripGit(segment: string): string {
	return segment.replace(/\.git$/, "")
}

/**
 * A repo as a forge URL (`https://gitlab.com/group/sub/repo`, `github.com/owner/name`) or the bare `owner/name` the sync column used to hold.
 *
 * Both forms reach here and cannot share one parse: `new URL()` on a bare `owner/name` reads `owner` as the HOSTNAME, so it never matches a forge and every bare slug would be refused. The tell is whether the value names a host at all – a scheme, or a leading `www.`/hostname segment before the first slash.
 *
 * `opts.forge` names the forge a bare slug is assumed to belong to. Without it, a slug cannot resolve and comes back null: a `owner/name` with no host is genuinely ambiguous, and guessing would point the sync at the wrong service.
 */
export function parseRepoRef(value: string, opts: { forge?: Forge } = {}): RepoRef | null {
	const raw = value.trim()
	if (!raw) return null

	const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
	// A value that names a host has a dot before its first slash (or no slash at all, as in `github.com`). That is what separates a URL from a slug.
	const firstSegment = raw.split("/")[0] ?? ""
	const namesHost = withScheme || firstSegment.includes(".")

	if (!namesHost) {
		// A bare slug: the caller has to say which forge it is meant for.
		if (!opts.forge) return null
		const parts = raw.split("/").filter(Boolean)
		return fromSegments(opts.forge, parts)
	}

	let hostname: string
	let pathname: string
	try {
		const u = new URL(withScheme ? raw : `https://${raw}`)
		;({ hostname, pathname } = u)
	} catch {
		return null
	}

	const forge = forgeFromRepoUrlOrNull(`https://${hostname}`)
	if (!forge) return null
	return fromSegments(forge, pathname.split("/").filter(Boolean))
}

/**
 * The exact path segments of a repo URL, checked and shaped into a `RepoRef`.
 *
 * GitHub repos are exactly two segments (`owner/name`). GitLab permits any number from two up, because a repo may sit under nested groups, so `ownerPath` is everything but the last and the depth is only bound-checked, not fixed.
 */
function fromSegments(forge: Forge, segments: string[]): RepoRef | null {
	if (segments.length < 2) return null
	if (!forge.nestedGroups && segments.length !== 2) return null

	const repo = stripGit(segments.at(-1) ?? "")
	const ownerSegments = segments.slice(0, -1)

	if (!repo || ownerSegments.length === 0) return null
	// Every segment has to be safe on its own: this is what stops a traversal (`a/..%2f..%2fadmin`) from reaching an API path we built from it.
	for (const segment of [...ownerSegments, repo]) if (!SEGMENT.test(segment)) return null
	// A `.` or `..` segment passes SEGMENT (the dot is allowed) but means a path step, not a name. Refused outright rather than normalised away.
	if ([...ownerSegments, repo].some(s => s === "." || s === "..")) return null

	const ownerPath = ownerSegments.join("/")
	return { forge, fullName: `${ownerPath}/${repo}`, ownerPath, repo }
}

/**
 * A repo reference back into the URL it came from, for storage and for links.
 *
 * The sync pins its target as a full URL rather than a slug now, precisely so the forge stays inferable from the stored value alone.
 */
export function repoRefToUrl(ref: RepoRef): string {
	return `https://${ref.forge.hostname}/${ref.fullName}`
}

/**
 * The repo reference for a project's stored repo link, or null when it is not a forge we can act on (a Codeberg URL, say).
 *
 * A project's `githubRepo` is allowed to be any repo link – a maker may keep their work somewhere we do not speak, and the link is still theirs to show. Only the read and write paths need this to resolve, and they refuse when it does not.
 */
export function repoRefFromLink(link: string | null | undefined): RepoRef | null {
	if (!link) return null
	return parseRepoRef(link)
}
