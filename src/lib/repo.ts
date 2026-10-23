/** What the repo field says when someone pastes an Onshape document into it. */
export const ONSHAPE_REPO_ERROR = "That is an Onshape link, not a repo – add it as a demo link instead."

/**
 * Whether a hostname belongs to Onshape, subdomains included (`cad.onshape.com`).
 *
 * An Onshape document is a design link: one CAD document opened in a browser, not a repository that holds a project's files. The repo field and the checks that read it treat the link as source, so an Onshape URL there is refused rather than saved and found out at submission.
 */
export function isOnshapeHost(hostname: string): boolean {
	const host = hostname.trim().toLowerCase().replace(/\.$/, "")
	return host === "onshape.com" || host.endsWith(".onshape.com")
}

/** Whether a link points at an Onshape document. A value that will not parse is not one; the field reports that separately. */
export function isOnshapeLink(input: string): boolean {
	const raw = input.trim()
	if (!raw) return false
	const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
	try {
		return isOnshapeHost(new URL(withScheme).hostname)
	} catch {
		return false
	}
}

/** A URL or bare host in prose: a description or a journal entry is not a URL field. */
const LINK_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+|(?:[a-z\d-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`)\]]*)?/gi

/** Whether prose mentions an Onshape document – the description check, where the link arrives in a sentence rather than a URL field. */
export function containsOnshapeLink(text: string): boolean {
	return [...text.matchAll(LINK_IN_TEXT)].some(([url]) => isOnshapeLink(url ?? ""))
}

/**
 * A project's repo link, as typed and as shown.
 *
 * People paste `github.com/me/hackpad`, `https://github.com/me/hackpad.git`, or the URL with a trailing slash, and all of those mean the same repo. The API takes any http(s) URL – a GitLab or Codeberg repo is a repo too – so the only work here is adding the scheme people leave off and refusing what will not parse, before a round trip says the same thing less helpfully.
 */
export function normalizeRepo(input: string): { url: string | null; error: string | null } {
	const raw = input.trim()
	if (!raw) return { error: null, url: null }
	const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
	try {
		const parsed = new URL(withScheme)
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
			return { error: "That needs to be a web link.", url: null }

		if (!parsed.hostname.includes(".")) return { error: "That does not look like a repo link.", url: null }

		return { error: null, url: parsed.toString().replace(/\/$/, "") }
	} catch {
		return { error: "That does not look like a repo link.", url: null }
	}
}

/**
 * The repo field's rule: a normalised link, or why it cannot be saved.
 *
 * Kept apart from `normalizeRepo`, which other callers use to read a stored link back out. A project's old link may be anything a maker was once allowed to save, and the paths that send or import one should not start refusing it; only the field that takes a new one rejects an Onshape document, because that is where a design link is mistaken for a repo.
 */
export function validateRepoField(input: string): { url: string | null; error: string | null } {
	const normalized = normalizeRepo(input)
	if (normalized.error) return normalized
	if (isOnshapeLink(input)) return { error: ONSHAPE_REPO_ERROR, url: null }
	return normalized
}

/** `github.com/me/hackpad` – the link without the parts nobody reads. */
export function displayRepo(url: string): string {
	return url
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "")
		.replace(/\.git$/, "")
		.replace(/\/$/, "")
}
