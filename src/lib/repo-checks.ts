import "server-only"
import type { Theme } from "@/app/generated/prisma/enums"
import { DESIGN_JSON, REPO_FILE_KINDS, type RepoFileKind, THEME_REPO_REQUIREMENTS } from "@/lib/config/repo-checks"
import { type Forge, fileUrl, forgeByHostname, hostnameOf } from "@/lib/forge"
import { ForgeUnavailableError, forgeGet } from "@/lib/github"
import { type RepoRef, repoRefFromLink } from "@/lib/repo-ref"
import { README_GUIDE_URL } from "@/lib/routes"

/**
 * Pre-submission repo checks, ported from Hack Club Stasis (lib/github-checks) and now forge-aware.
 *
 * The checks themselves are the same on every forge – a README, photos in it, and the file kinds the week exists to produce. What changes per forge is how the file list and the README are read, which is why `fetchSnapshot` branches and everything below it does not.
 *
 * A forge we do not speak is still a repo a maker may hand in: `checkRepo` warns rather than blocks, exactly as it did for a GitLab link before GitLab was understood. That path stays, because Codeberg and a self-hosted Gitea are still real answers to "where is your project".
 */

export interface RepoCheck {
	/** A failed blocking check stops the hand-in. */
	blocking?: boolean
	detail?: string
	key: string
	label: string
	/** Where to read what to do about it, when a doc explains it better than the one-line detail can. */
	link?: { href: string; label: string }
	status: "pass" | "fail" | "warn"
}

export interface RepoCheckResult {
	canSubmit: boolean
	checkedAt: string
	checks: RepoCheck[]
	repo: string | null
	/** The forge could not be asked; nothing was concluded about the repo. */
	unavailable: boolean
}

/** What a forge said about a repo – everything the checks are built from. */
type Snapshot =
	| {
			kind: "ok"
			/** Lowercased, for matching. */
			paths: string[]
			/** The same files as the forge spells them, index for index – for links. */
			files: string[]
			readme: string | null
			/**
			 * The file list was cut short (GitHub stops at about 100,000 entries), so a file missing from `paths` may still be in the repo.
			 */
			truncated: boolean
			/**
			 * Which of the repo's `.json` files are a board or a schematic, by reading them (see DESIGN_JSON).
			 *
			 * A function rather than a list, because reading costs a request per file and only a kind that has found nothing by name ever asks – most repos never do, and a repo that does asks once and the answer is held for as long as the snapshot is.
			 */
			designs(): Promise<string[]>
	  }
	| { kind: "not-found" }
	| { kind: "unavailable"; why: string }

/** A snapshot the forge answered for, which is the only one the checks are built from. */
type RepoSnapshot = Extract<Snapshot, { kind: "ok" }>

/**
 * How long one answer from a forge is reused for a repo.
 *
 * One hand-in asks several times: the project page, the submit sheet, and the submit itself, which re-checks rather than trusting the sheet. A minute is short enough that a maker who has just pushed waits at most that long to see it, and long enough to fold one hand-in into one fetch.
 */
const SNAPSHOT_TTL_MS = 60_000

/**
 * How long "could not check" is reused. Short, because it is usually a blip – the proxy failing for a second – and holding it for the full minute told makers GitHub was down long after it was back. A rate limit is not what this protects against: lib/github already refuses to call while one lasts.
 */
const UNAVAILABLE_TTL_MS = 10_000

/** A bound on memory for a burst of distinct repos; expired entries go first. */
const SNAPSHOT_CACHE_MAX = 500

/**
 * Per server process, keyed by `forge/completename` lowercased – forge names are case-insensitive, and two spellings of one repo should share one fetch. The value is the promise, not the result, so concurrent checks of the same repo (React's double mount in dev, a page and a sheet opening together) wait on one request instead of each starting their own.
 */
const snapshots = new Map<string, { at: number; ttl: number; value: Promise<Snapshot> }>()

function snapshot(ref: RepoRef): Promise<Snapshot> {
	const key = `${ref.forge.id}/${ref.fullName}`.toLowerCase()
	const now = Date.now()
	const hit = snapshots.get(key)
	if (hit && now - hit.at < hit.ttl) return hit.value

	if (snapshots.size >= SNAPSHOT_CACHE_MAX) {
		for (const [k, v] of snapshots) if (now - v.at >= v.ttl) snapshots.delete(k)
		// Still full of live entries: drop the oldest. Map keeps insertion order.
		const oldest = snapshots.keys().next()
		if (snapshots.size >= SNAPSHOT_CACHE_MAX && !oldest.done) snapshots.delete(oldest.value)
	}

	// Never rejects. The promise is what the cache holds, so a rejected one would be handed to every check of this repo for the next minute – each of them a 500 – instead of the short-lived "could not check" it should be.
	const value = fetchSnapshot(ref).catch((err): Snapshot => {
		console.warn(`[repo-checks] ${ref.forge.id}/${ref.fullName} failed unexpectedly:`, err)
		return { kind: "unavailable", why: `${ref.forge.label} did not answer.` }
	})
	const entry = { at: now, ttl: SNAPSHOT_TTL_MS, value }
	snapshots.set(key, entry)
	// Settled, a failure is only kept briefly. Checked against the entry itself, so a newer fetch that has replaced it is left alone.
	value.then(snap => {
		if (snap.kind === "unavailable" && snapshots.get(key) === entry) entry.ttl = UNAVAILABLE_TTL_MS
	})
	return value
}

/** Read the file list and README from whichever forge the repo lives on. */
function fetchSnapshot(ref: RepoRef): Promise<Snapshot> {
	return ref.forge.id === "gitlab" ? fetchGitLabSnapshot(ref) : fetchGitHubSnapshot(ref)
}

/**
 * How many `.json` files one repo may have opened to find a design in them.
 *
 * Every one is a request, and a firmware repo carries its share of JSON, so only the plausible candidates are opened and only up to this many – shallowest first, which is where a design usually lands. Missing one is the mild end of this deal: the kind reads as not found and a reviewer opens the repo, rather than a design being wrongly credited.
 */
const DESIGN_JSON_MAX = 5

/** Directories no design is exported into, and the usual suspects in a JavaScript repo. Case-blind, like every other path test here. */
const DESIGN_JSON_SKIP =
	/(^|\/)(node_modules|dist|build|out|coverage|vendor|\.next|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)/i

/**
 * Which of the repo's `.json` files are a board or a schematic, by reading the plausible ones.
 *
 * Asked at most once per snapshot, whatever asks: a hand-in checks the same repo three times over, and the answer for all three is the same answer.
 */
function designFinder(ref: RepoRef, files: readonly string[]): () => Promise<string[]> {
	let answer: Promise<string[]> | null = null
	return () => (answer ??= findDesignJson(ref, files))
}

async function findDesignJson(ref: RepoRef, files: readonly string[]): Promise<string[]> {
	const candidates = files
		.filter(p => p.toLowerCase().endsWith(DESIGN_JSON.extension) && !DESIGN_JSON_SKIP.test(p))
		.toSorted((a, b) => a.split("/").length - b.split("/").length || a.length - b.length)
		.slice(0, DESIGN_JSON_MAX)
	if (candidates.length === 0) return []

	const texts = await Promise.all(
		candidates.map(path =>
			// A forge that will not serve one file is the same as that file being unreadable: the kind goes on not being found, which a reviewer looks at by hand rather than a blocked hand-in.
			readRepoFileAt(ref, path).catch(err => {
				console.warn(`[repo-checks] could not read ${ref.forge.id}/${ref.fullName}/${path}:`, err)
				return null
			}),
		),
	)

	const designs: string[] = []
	for (const [i, text] of texts.entries()) {
		const path = candidates[i]
		if (path && text && isDesignJson(text)) designs.push(path.toLowerCase())
	}
	return designs
}

/**
 * Whether a `.json` file says, in its opening, that it is a design.
 *
 * Only the opening is read: EasyEDA Standard puts the document type in `head`, Pro in the first record of the log, and either can be several megabytes of shape data after that. A file whose type is a number rather than a name is only believed when something else from the same editor is there too, since `"docType": "3"` on its own is a coincidence waiting to happen.
 */
function isDesignJson(text: string): boolean {
	const opening = text.slice(0, DESIGN_JSON.headerChars)
	const found = DESIGN_JSON.docType.exec(opening)
	if (!found?.[1]) return false
	const docType = found[1].toLowerCase()
	if (DESIGN_JSON.named.has(docType)) return true
	return DESIGN_JSON.numeric.has(docType) && DESIGN_JSON.fingerprint.test(opening)
}

/**
 * Two requests, side by side. The file list is read at HEAD – the default branch, whatever it is called – so there is no need to ask for the repo first just to learn the branch name, which is what used to make this three. The file list also answers whether the repo exists: 404 there means it does not, or is private, which to a reviewer is the same thing.
 */
async function fetchGitHubSnapshot(ref: RepoRef): Promise<Snapshot> {
	const forge = ref.forge
	const base = `repos/${ref.fullName}`
	let treeRes: Response
	let readmeRes: Response
	try {
		;[treeRes, readmeRes] = await Promise.all([
			forgeGet(forge, `${base}/git/trees/HEAD?recursive=1`),
			forgeGet(forge, `${base}/readme`),
		])
	} catch (err) {
		return {
			kind: "unavailable",
			why: err instanceof ForgeUnavailableError ? err.message : `${forge.label} did not answer.`,
		}
	}

	if (treeRes.status === 404) return { kind: "not-found" }
	// 409 is an empty repo: no commits, so no tree. That is a real finding.
	if (!treeRes.ok && treeRes.status !== 409)
		return { kind: "unavailable", why: `${forge.label} returned an error (${treeRes.status}).` }

	// 404 is the only answer that means there is no README. Anything else is the forge failing to say, and blocking on that would tell the maker to add a README they already have.
	if (!readmeRes.ok && readmeRes.status !== 404)
		return { kind: "unavailable", why: `${forge.label} returned an error (${readmeRes.status}).` }

	const body = treeRes.ok
		? ((await treeRes.json()) as { tree?: { path: string; type: string }[]; truncated?: boolean })
		: { tree: [], truncated: false }
	const files = (body.tree ?? []).filter(f => f.type === "blob").map(f => f.path)
	const paths = files.map(p => p.toLowerCase())

	let readme: string | null = null
	if (readmeRes.ok) {
		const r = (await readmeRes.json()) as { content?: string; encoding?: string }
		if (r.content && r.encoding === "base64") readme = Buffer.from(r.content, "base64").toString("utf-8")
	}

	return { designs: designFinder(ref, files), files, kind: "ok", paths, readme, truncated: body.truncated === true }
}

/**
 * GitLab's tree API, walked page by page.
 *
 * GitLab has no `truncated` flag and no README endpoint that finds the README
 * for you, so this asks for the tree and then reads the README by the name it
 * actually found. Both lists are paginated at 100, and a project with more files than one page would silently look emptier than it is – which, for a required-file check, means failing a maker who did the work. So the tree is walked until GitLab stops offering a next page.
 */
async function fetchGitLabSnapshot(ref: RepoRef): Promise<Snapshot> {
	const forge = ref.forge
	const project = encodeURIComponent(ref.fullName)

	let first: Response
	try {
		first = await forgeGet(forge, `projects/${project}/repository/tree?ref=HEAD&recursive=true&per_page=100`)
	} catch (err) {
		return {
			kind: "unavailable",
			why: err instanceof ForgeUnavailableError ? err.message : `${forge.label} did not answer.`,
		}
	}
	if (first.status === 404) return { kind: "not-found" }
	if (!first.ok) return { kind: "unavailable", why: `${forge.label} returned an error (${first.status}).` }

	const files: string[] = []
	// A generous ceiling: 100 pages of 100 is 10,000 files, which no hardware project is, and it stops a pathological repo looping here forever.
	const MAX_PAGES = 100
	let page = 1
	let res = first
	while (page <= MAX_PAGES) {
		const entries = (await res.json()) as { path: string; type: string }[]
		for (const entry of entries) if (entry.type === "blob") files.push(entry.path)
		const next = res.headers.get("x-next-page")
		if (!next) break
		page = Number(next)
		if (!Number.isFinite(page) || page <= 0) break
		const more = await forgeGet(
			forge,
			`projects/${project}/repository/tree?ref=HEAD&recursive=true&per_page=100&page=${page}`,
		)
		if (!more.ok) break
		res = more
	}

	const paths = files.map(p => p.toLowerCase())
	const readme = await fetchGitLabReadme(forge, project, files)
	// GitLab lists the whole tree when asked to recurse, so a file absent from `paths` is genuinely absent – there is no "cut short" state to carry.
	return { designs: designFinder(ref, files), files, kind: "ok", paths, readme, truncated: false }
}

/**
 * The README's text, by the name the tree actually uses.
 *
 * GitHub has a `/readme` endpoint that finds it whatever it is called; GitLab does not, so the name is taken from the file list. A repo with several spellings (`README.md`, `readme.rst`) is read from the first that sorts, and only the common names are tried – this is a "has a README" check, not a search for any file that might be prose.
 */
const README_NAMES = new Set(["readme.md", "readme.markdown", "readme.rst", "readme.txt", "readme"])

async function fetchGitLabReadme(forge: Forge, project: string, files: readonly string[]): Promise<string | null> {
	// Root-level names first, then anything nested, so a docs/README does not shadow the project's own.
	const candidates = files
		.filter(f => README_NAMES.has((f.split("/").pop() ?? "").toLowerCase()))
		.toSorted((a, b) => a.split("/").length - b.split("/").length)
	const name = candidates[0]
	if (!name) return null

	const res = await forgeGet(forge, `projects/${project}/repository/files/${encodeURIComponent(name)}/raw?ref=HEAD`)
	if (!res.ok) return null
	return res.text()
}

/** Markdown or HTML images. Global so the README can be counted as well as tested. */
const README_IMAGE = /!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]|<img\b[^>]*>/gi
const README_MIN_CHARS = 200
const README_MIN_IMAGES = 2

/** How many images the README embeds. */
function readmeImageCount(readme: string): number {
	return [...readme.matchAll(README_IMAGE)].length
}

/** The README's prose, with images and the whitespace they leave behind removed. */
function readmeText(readme: string): string {
	return readme.replaceAll(README_IMAGE, " ").replaceAll(/\s+/g, " ").trim()
}

/** The paths in the repo that satisfy a file kind by name. */
function namedMatches(kind: RepoFileKind, snap: RepoSnapshot): string[] {
	const def = REPO_FILE_KINDS[kind]
	const pattern = def.pattern
	if (pattern) return snap.paths.filter(p => pattern.test(p))
	return snap.paths.filter(p => (def.extensions ?? []).some(ext => p.endsWith(ext)))
}

/**
 * The paths that satisfy a file kind.
 *
 * `designs` are the repo's JSON designs, which have to be read rather than matched by name (see DESIGN_JSON). A kind that accepts one falls back to them only when its own extensions found nothing, so a repo with a `.kicad_pcb` in it is never asked to have its JSON opened.
 */
function matches(kind: RepoFileKind, snap: RepoSnapshot, designs: readonly string[]): string[] {
	const named = namedMatches(kind, snap)
	if (named.length > 0 || !REPO_FILE_KINDS[kind].json) return named
	return [...designs]
}

function sample(found: readonly string[]): string {
	const shown = found
		.slice(0, 3)
		.map(p => p.split("/").pop())
		.join(", ")
	return found.length > 3 ? `${shown} and ${found.length - 3} more` : shown
}

function result(repo: string | null, checks: RepoCheck[], unavailable = false): RepoCheckResult {
	return {
		canSubmit: !checks.some(c => c.blocking && c.status === "fail"),
		checkedAt: new Date().toISOString(),
		checks,
		repo,
		unavailable,
	}
}

export async function checkRepo(repoLink: string | null, theme: Theme): Promise<RepoCheckResult> {
	if (!repoLink)
		return result(null, [
			{
				blocking: true,
				detail: `Add your project's repo so a reviewer can see the files. Select "Edit details" above and add to the "Repo link" field.`,
				key: "repo",
				label: "No repo yet",
				status: "fail",
			},
		])

	const ref = repoRefFromLink(repoLink)
	if (!ref) {
		// `normalizeRepo` accepts any http(s) repo – a Codeberg project is a repo too – but the checks below talk to a forge API. Warn rather than block, so the link the maker was allowed to save is one they can hand in; a reviewer opens it by hand.
		const foreignHost = foreignRepoHost(repoLink)
		if (foreignHost) return result(repoLink, [nonForgeWarn(foreignHost)], true)
		return result(repoLink, [
			{
				blocking: true,
				detail: "Use the link to the repo itself, like github.com/you/your-project.",
				key: "repo",
				label: "Not a repo link",
				status: "fail",
			},
		])
	}

	const name = ref.fullName
	const forge = ref.forge

	const unavailable = (why: string) =>
		result(
			repoLink,
			[
				{
					detail: `${why} You can still submit; a reviewer will check the repo by hand.`,
					key: "repo",
					label: "Could not check the repo",
					status: "warn",
				},
			],
			true,
		)

	const snap = await snapshot(ref)
	if (snap.kind === "unavailable") return unavailable(snap.why)
	if (snap.kind === "not-found")
		return result(repoLink, [
			{
				blocking: true,
				detail: `${name} does not exist or is private. Make it public so a reviewer can open it.`,
				key: "repo",
				label: "Repo not found",
				status: "fail",
			},
		])

	const { readme, truncated } = snap

	const { required, recommended } = THEME_REPO_REQUIREMENTS[theme]
	// Reading the repo's JSON is what finds an EasyEDA design, so it is done only when a kind that accepts one has found nothing by name – which for a PCB week is a repo exported from EasyEDA, and for every other repo never happens.
	const designs = [...required, ...recommended].some(
		kind => REPO_FILE_KINDS[kind].json && namedMatches(kind, snap).length === 0,
	)
		? await snap.designs()
		: []

	const checks: RepoCheck[] = [
		{ detail: name, key: "repo", label: `Public ${forge.label} repo`, status: "pass" },
		readme !== null
			? { key: "readme", label: "README", status: "pass" }
			: {
					blocking: true,
					detail: "Add a README.md saying what the project is, how it works, and why you made it.",
					key: "readme",
					label: "README missing",
					link: { href: README_GUIDE_URL, label: "What goes in a README" },
					status: "fail",
				},
	]
	const readmeChars = readme === null ? 0 : readmeText(readme).length
	const imageCount = readme === null ? 0 : readmeImageCount(readme)

	checks.push(
		readme !== null && readmeChars >= README_MIN_CHARS
			? { detail: `${readmeChars} characters`, key: "readme_length", label: "README length", status: "pass" }
			: {
					blocking: true,
					detail: `Add at least ${README_MIN_CHARS} characters about what the project is and how it works. The README has ${readmeChars} once images are removed.`,
					key: "readme_length",
					label: "README too short",
					link: { href: README_GUIDE_URL, label: "What goes in a README" },
					status: "fail",
				},
		readme !== null && imageCount >= README_MIN_IMAGES
			? { detail: `${imageCount} images`, key: "readme_photo", label: "Photos in the README", status: "pass" }
			: {
					blocking: true,
					detail: `Add at least ${README_MIN_IMAGES} images of the project – renders, screenshots of the board, or photos. The README has ${imageCount}.`,
					key: "readme_photo",
					label: imageCount === 0 ? "No photos in the README" : "Not enough photos in the README",
					link: { href: README_GUIDE_URL, label: "What goes in a README" },
					status: "fail",
				},
	)

	for (const kind of required) {
		const found = matches(kind, snap, designs)
		const def = REPO_FILE_KINDS[kind]
		checks.push(
			found.length > 0
				? { detail: sample(found), key: kind, label: def.label, status: "pass" }
				: truncated
					? // Not found in a list the forge cut short is not the same as not
						// there, so it cannot block – a reviewer checks by hand instead.
						{
							detail: `The repo is too big for ${forge.label} to list in full, so this could not be confirmed. ${def.missing}`,
							key: kind,
							label: `${def.label} not found`,
							status: "warn",
						}
					: { blocking: true, detail: def.missing, key: kind, label: `${def.label} missing`, status: "fail" },
		)
	}
	for (const kind of recommended) {
		const found = matches(kind, snap, designs)
		const def = REPO_FILE_KINDS[kind]
		checks.push(
			found.length > 0
				? { detail: sample(found), key: kind, label: def.label, status: "pass" }
				: {
						detail: `${def.missing}. Not required; add it if it fits your project.`,
						key: kind,
						label: `${def.label} not found`,
						status: "warn",
					},
		)
	}

	return result(repoLink, checks)
}

/**
 * The hostname of a repo link on a service we do not speak, or null.
 *
 * `repoRefFromLink` returns null for two different things: a URL for a forge we do not know (Codeberg, a self-hosted Gitea) and a string that is not a repo at all. Only the first is worth a warning – the maker saved a real repo, just not one these checks can read – so this tells them apart by shape: a parseable URL or hostname with at least two path segments (`owner/name`), which is what every forge's repo URL has.
 *
 * A GitLab repo with a traversal segment is *also* refused by `parseRepoRef`, but it belongs to a forge we know; letting it fall through to the warning would say "another service" about gitlab.com. So a known forge's host is excluded here too, and such a link reads as malformed instead.
 */
function foreignRepoHost(link: string): string | null {
	const host = hostnameOf(link)
	if (!host) return null
	if (forgeByHostname(host)) return null
	const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(link) ? link : `https://${link}`
	try {
		const pathname = new URL(withScheme).pathname
		return pathname.split("/").filter(Boolean).length >= 2 ? host : null
	} catch {
		return null
	}
}

/** A repo on a host we cannot read: a hand-check, not a failure. */
function nonForgeWarn(host: string): RepoCheck {
	return {
		detail: `${host} is not a service Half Life can read, so these file checks cannot run. You can still submit; a reviewer will open the repo by hand.`,
		key: "repo",
		label: "Repo is on another service",
		status: "warn",
	}
}

/**
 * A link to the first file in the repo whose path matches, or null.
 *
 * Reads the same cached file list the checks use, so asking costs nothing extra when a check has just run – which, at submit, it always has. Shallowest match wins, so a root JOURNAL.md beats one in a subfolder.
 */
export async function findRepoFile(repoLink: string | null, test: RegExp): Promise<string | null> {
	const ref = repoRefFromLink(repoLink)
	if (!ref) return null
	const path = await findRepoFilePath(repoLink, test)
	if (!path) return null
	const encoded = path.split("/").map(encodeURIComponent).join("/")
	return fileUrl(ref.forge, ref.ownerPath, ref.repo, encoded)
}

/**
 * The shallowest path in the repo whose name matches, or null.
 *
 * The same search `findRepoFile` runs, but returning the path rather than a web link – for callers that mean to read the file's bytes rather than point at it, such as the BOM import. Reads the same cached file list, so calling both for one project costs one fetch.
 */
export async function findRepoFilePath(repoLink: string | null, test: RegExp): Promise<string | null> {
	const ref = repoRefFromLink(repoLink)
	if (!ref) return null
	const snap = await snapshot(ref)
	if (snap.kind !== "ok") return null
	const hits = snap.files.filter(f => test.test(f)).toSorted((a, b) => a.split("/").length - b.split("/").length)
	return hits[0] ?? null
}

/**
 * The text of one file in the repo, or null when it cannot be read.
 *
 * The two forges speak differently here – GitHub's contents API answers with base64, GitLab's raw endpoint with the bytes – so this is the one place that difference lives. It reads the file at HEAD, the default branch, and treats a missing, binary or oversized file as simply unreadable: the caller has picked a path it matched in the same file list, so "not there" is a race, not an error worth a different message.
 */
export function readRepoFile(repoLink: string | null, path: string): Promise<string | null> {
	const ref = repoRefFromLink(repoLink)
	if (!ref) return Promise.resolve(null)
	return readRepoFileAt(ref, path)
}

/** The same read, for a repo already resolved to a forge – so a caller holding a `RepoRef` does not resolve it twice. */
async function readRepoFileAt(ref: RepoRef, path: string): Promise<string | null> {
	// GitLab takes the file path as one encoded value, slashes included, the way the README read above does; GitHub's contents API takes it as path segments, so each is encoded on its own.
	if (ref.forge.id === "gitlab") {
		const res = await forgeGet(
			ref.forge,
			`projects/${encodeURIComponent(ref.fullName)}/repository/files/${encodeURIComponent(path)}/raw?ref=HEAD`,
		)
		if (!res.ok) return null
		return res.text()
	}

	const encoded = path.split("/").map(encodeURIComponent).join("/")
	const res = await forgeGet(ref.forge, `repos/${ref.fullName}/contents/${encoded}?ref=HEAD`)
	if (!res.ok) return null
	const body = (await res.json().catch(() => null)) as { content?: string; encoding?: string } | null
	// GitHub omits `content` for files over a megabyte and sets `encoding` to `none`; a BOM CSV is never one, so that is just unreadable.
	if (!body?.content || body.encoding !== "base64") return null
	return Buffer.from(body.content, "base64").toString("utf-8")
}
