/**
 * A project's repo link, as typed and as shown.
 *
 * People paste `github.com/me/hackpad`, `https://github.com/me/hackpad.git`, or the URL with a trailing slash, and all of those mean the same repo. The API takes any http(s) URL – a GitLab or Codeberg repo is a repo too – so the only work here is adding the scheme people leave off and refusing what will not parse, before a round trip says the same thing less helpfully.
 */
function normalizeRepo(input: string): { url: string | null; error: string | null } {
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

/** `github.com/me/hackpad` – the link without the parts nobody reads. */
function displayRepo(url: string): string {
	return url
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "")
		.replace(/\.git$/, "")
		.replace(/\/$/, "")
}

export { displayRepo, normalizeRepo }
