import "server-only"
import { FORGES } from "@/lib/forge"
import { ForgeUnavailableError, forgeGet } from "@/lib/github"
import { isGithubRepo } from "@/lib/review-platform/repo"

/**
 * The GitHub reads behind the review file viewer – Fabricate's `RepoFilesService`, on Half Life's GitHub client.
 *
 * Every call goes through `forgeGet`, so it shares gh-proxy's token pool, its retries and its backoff with the repo checks rather than spending a budget of its own. The viewer fetches file bodies straight from raw.githubusercontent.com in the browser; this side only answers what needs the API: the tree, the commits and a compare.
 *
 * Fabricate caches in Rails.cache; here it is a small per-instance map. Snapshots and compares are keyed by commit sha, so they never go stale – only the head lookup is short-lived.
 */

const BRANCH_TTL_MS = 60 * 60 * 1000
const HEAD_TTL_MS = 60 * 1000
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000
const COMPARE_FILE_LIMIT = 300
const PATCH_LIMIT = 100 * 1024
const COMMIT_PAGE = 100
const COMMIT_PAGES = 10
const CACHE_LIMIT = 500
const SHA = /^[0-9a-f]{7,40}$/i
const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Entry {
	at: number
	ttl: number
	value: unknown
}

const cache = new Map<string, Entry>()

async function cached<T>(key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
	const hit = cache.get(key)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each key is only ever written by the one loader that reads it back
	if (hit && Date.now() - hit.at < hit.ttl) return hit.value as T
	const value = await load()
	// Misses are not kept, so a repository that was briefly unreachable is asked again next time.
	if (value === null) return null
	if (cache.size >= CACHE_LIMIT) {
		const oldest = cache.keys().next().value
		if (oldest !== undefined) cache.delete(oldest)
	}
	cache.set(key, { at: Date.now(), ttl, value })
	return value
}

const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/")

async function apiJson(path: string): Promise<unknown> {
	try {
		const res = await forgeGet(FORGES.github, path)
		if (!res.ok) return null
		return await res.json()
	} catch (err) {
		if (err instanceof ForgeUnavailableError) return null
		throw err
	}
}

const isRecord = (value: unknown): value is { [_: string]: unknown } =>
	typeof value === "object" && value !== null && !Array.isArray(value)

export interface SnapshotFile {
	path: string
	size: number
	submodule?: true
}

export interface Snapshot {
	branch: string
	files: SnapshotFile[]
	repo: string
	sha: string
	truncated: boolean
}

export interface CommitEntry {
	author: string | null
	date: string | null
	message: string
	sha: string
}

export interface CompareFile {
	additions: number
	deletions: number
	filename: string
	patch: string | null
	patch_truncated: boolean
	previous_filename: string | null
	status: string
}

export class RepoFiles {
	readonly repo: string

	constructor(repo: string) {
		if (!isGithubRepo(repo)) throw new Error(`not a GitHub repository: ${repo}`)
		this.repo = repo
	}

	private metadata(): Promise<{ branch: string; private: boolean } | null> {
		return cached(`meta:${this.repo}`, BRANCH_TTL_MS, async () => {
			const data = await apiJson(`repos/${this.repo}`)
			if (!isRecord(data) || typeof data.default_branch !== "string") return null
			return { branch: data.default_branch, private: data.private !== false }
		})
	}

	/** Only a public repository is opened – the same rule Fabricate's viewer keeps, and the only kind gh-proxy can read anyway. */
	async isPublic(): Promise<boolean> {
		return (await this.metadata())?.private === false
	}

	private async head(): Promise<{ branch: string; sha: string } | null> {
		const meta = await this.metadata()
		if (!meta) return null
		const sha = await cached(`head:${this.repo}:${meta.branch}`, HEAD_TTL_MS, async () => {
			const data = await apiJson(`repos/${this.repo}/git/ref/heads/${encodePath(meta.branch)}`)
			const object = isRecord(data) ? data.object : null
			return isRecord(object) && typeof object.sha === "string" ? object.sha : null
		})
		return sha ? { branch: meta.branch, sha } : null
	}

	async snapshot(): Promise<Snapshot | null> {
		const head = await this.head()
		if (!head) return null
		return cached(`snapshot:${this.repo}:${head.sha}`, SNAPSHOT_TTL_MS, async () => {
			const tree = await apiJson(`repos/${this.repo}/git/trees/${encodePath(head.sha)}?recursive=1`)
			if (!isRecord(tree) || !Array.isArray(tree.tree)) return null
			const files: SnapshotFile[] = []
			for (const entry of tree.tree) {
				if (!isRecord(entry) || typeof entry.path !== "string") continue
				if (entry.type === "blob") files.push({ path: entry.path, size: Number(entry.size) || 0 })
				else if (entry.type === "commit") files.push({ path: entry.path, size: 0, submodule: true })
			}
			return { branch: head.branch, files, repo: this.repo, sha: head.sha, truncated: tree.truncated === true }
		})
	}

	async commits(since: Date | null): Promise<{ commits: CommitEntry[]; complete: boolean } | null> {
		const head = await this.head()
		if (!head) return null
		const day = since ? since.toISOString().slice(0, 10) : "all"
		return cached(`commits:${this.repo}:${head.sha}:${day}`, SNAPSHOT_TTL_MS, async () => {
			const commits: CommitEntry[] = []
			for (let page = 1; page <= COMMIT_PAGES; page++) {
				const batch = await apiJson(
					`repos/${this.repo}/commits?sha=${encodeURIComponent(head.sha)}&per_page=${COMMIT_PAGE}&page=${page}`,
				)
				if (!Array.isArray(batch)) return commits.length > 0 ? { commits, complete: false } : null
				for (const raw of batch) commits.push(commitEntry(raw))
				if (batch.length < COMMIT_PAGE) return { commits, complete: true }
				const last = commits.at(-1)?.date
				if (since === null || (last && new Date(last) < since)) break
			}
			return { commits, complete: false }
		})
	}

	compare(
		base: string,
		head: string,
	): Promise<{ files: CompareFile[]; total_commits: number; truncated: boolean } | null> {
		if (!SHA.test(base) || !SHA.test(head)) return Promise.resolve(null)
		return cached(`compare:${this.repo}:${base}:${head}`, SNAPSHOT_TTL_MS, async () => {
			const data = await apiJson(`repos/${this.repo}/compare/${encodePath(base)}...${encodePath(head)}`)
			if (!isRecord(data)) return null
			const files = Array.isArray(data.files) ? data.files : []
			return {
				files: files.filter(isRecord).map(compareEntry),
				total_commits: Number(data.total_commits) || 0,
				truncated: files.length >= COMPARE_FILE_LIMIT,
			}
		})
	}

	/**
	 * A README's restricted `user-attachments` image. GitHub signs those only inside its own rendering of the file, so the rendered HTML is fetched and the one signed URL picked out of it. Direct rather than through the proxy, because the proxy only speaks the JSON media type.
	 */
	async attachmentUrl(path: string, id: string): Promise<string | null> {
		const data = await this.snapshot()
		if (!ATTACHMENT_ID.test(id) || !data?.files.some(file => file.path === path)) return null
		const token = process.env.GITHUB_TOKEN
		let html: string
		try {
			const res = await fetch(
				`https://api.github.com/repos/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(data.sha)}`,
				{
					cache: "no-store",
					headers: {
						Accept: "application/vnd.github.html+json",
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
					signal: AbortSignal.timeout(10_000),
				},
			)
			if (!res.ok) return null
			html = await res.text()
		} catch {
			return null
		}
		const pattern = new RegExp(
			String.raw`https://private-user-images\.githubusercontent\.com/\d+/\d+-${id}\.\w+\?jwt=[\w.-]+`,
		)
		return pattern.exec(html)?.[0] ?? null
	}
}

function commitEntry(raw: unknown): CommitEntry {
	const commit = isRecord(raw) && isRecord(raw.commit) ? raw.commit : {}
	const author = isRecord(commit.author) ? commit.author : {}
	const committer = isRecord(commit.committer) ? commit.committer : {}
	const login = isRecord(raw) && isRecord(raw.author) && typeof raw.author.login === "string" ? raw.author.login : null
	const message = typeof commit.message === "string" ? (commit.message.split("\n")[0] ?? "").trim() : ""
	return {
		author: typeof author.name === "string" ? author.name : login,
		date: typeof committer.date === "string" ? committer.date : typeof author.date === "string" ? author.date : null,
		message,
		sha: isRecord(raw) && typeof raw.sha === "string" ? raw.sha : "",
	}
}

function compareEntry(file: { [_: string]: unknown }): CompareFile {
	const patch = typeof file.patch === "string" ? file.patch : ""
	const bytes = Buffer.byteLength(patch)
	return {
		additions: Number(file.additions) || 0,
		deletions: Number(file.deletions) || 0,
		filename: typeof file.filename === "string" ? file.filename : "",
		patch: patch ? Buffer.from(patch).subarray(0, PATCH_LIMIT).toString("utf8") : null,
		patch_truncated: bytes > PATCH_LIMIT,
		previous_filename: typeof file.previous_filename === "string" ? file.previous_filename : null,
		status: typeof file.status === "string" ? file.status : "",
	}
}
