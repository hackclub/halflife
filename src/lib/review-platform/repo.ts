/**
 * `owner/name` for a GitHub repository link, or null for anything else.
 *
 * The review file viewer reads GitHub only, so a GitLab project or a stray link gets the viewer's own "not a GitHub repository" panel rather than a request that cannot succeed. Shared by the server (which decides what the viewer may open) and the client (which labels the link), so it stays free of server-only imports.
 */
const REPO = /^[A-Za-z0-9-]+\/(?!\.\.?$)[A-Za-z0-9._-]+$/

export const isGithubRepo = (repo: string): boolean => REPO.test(repo)

export function githubRepoFrom(link: string | null | undefined): string | null {
	const raw = link?.trim()
	if (!raw) return null
	let url: URL
	try {
		url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
	} catch {
		return null
	}
	if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null
	const [owner, name] = url.pathname.split("/").filter(Boolean)
	if (!owner || !name) return null
	const repo = `${owner}/${name.replace(/\.git$/i, "")}`
	return isGithubRepo(repo) ? repo : null
}
