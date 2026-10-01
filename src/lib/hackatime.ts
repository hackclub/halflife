import "server-only"
import prisma from "@/lib/prisma"

const BASE = process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"
const TIMEOUT_MS = 10_000

export interface HackatimeFetch {
	seconds: number
	/** True when the number came from cache or a failure, not a live fetch. */
	stale: boolean
	error?: string
	/**
	 * True when Hackatime answered and the named project is not in its list —
	 * the project was renamed or deleted. The approval path must treat this as
	 * "we don't know", never as a fresh zero.
	 */
	notFound?: boolean
}

interface StatsBody {
	data?: { projects?: { name?: unknown; total_seconds?: unknown }[] }
}

/**
 * Read one project's seconds out of a Hackatime stats response.
 *
 * Pure so the contract can be pinned without a network: a project that is
 * present with zero seconds is the ONLY live zero. A name missing from a
 * successfully fetched list means the project was renamed or deleted, and
 * reporting zero for it would silently underpay the hand-in the number is
 * about. A response with no usable project list is stale too — a shape change
 * must not look like "nothing logged".
 */
export function projectSecondsFrom(body: unknown, project: string): HackatimeFetch {
	const projects = (body as StatsBody | null)?.data?.projects
	if (!Array.isArray(projects)) {
		return { seconds: 0, stale: true, error: "Hackatime returned no project list" }
	}

	const match = projects.find((p) => p?.name === project)
	if (!match) {
		return {
			seconds: 0,
			stale: true,
			notFound: true,
			error: `Hackatime does not list a project named "${project}"`,
		}
	}

	const total = match.total_seconds
	const seconds = typeof total === "number" && Number.isFinite(total) ? Math.max(0, total) : 0
	return { seconds, stale: false }
}

/**
 * Returns `{ seconds, stale }` rather than a bare number on purpose.
 *
 * Stasis's client returns 0 on any error including a timeout, and that zero
 * flows straight into the hours field on the grant row with no signal. A blip
 * during an approval silently underpays someone. Here the caller can tell the
 * difference between "genuinely zero" and "we don't know", and the approval
 * path refuses to finalise on "we don't know".
 */
export async function fetchProjectSeconds(hackatimeUserId: string, project: string): Promise<HackatimeFetch> {
	try {
		const url = new URL(`${BASE}/api/v1/users/${encodeURIComponent(hackatimeUserId)}/stats`)
		url.searchParams.set("features", "projects")
		const res = await fetch(url, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			cache: "no-store",
		})
		if (!res.ok) return { seconds: 0, stale: true, error: `HTTP ${res.status}` }

		return projectSecondsFrom(await res.json(), project)
	} catch (err) {
		return { seconds: 0, stale: true, error: err instanceof Error ? err.message : String(err) }
	}
}

export async function listUserProjects(hackatimeUserId: string): Promise<{ name: string; totalSeconds: number }[]> {
	try {
		const url = new URL(`${BASE}/api/v1/users/${encodeURIComponent(hackatimeUserId)}/stats`)
		url.searchParams.set("features", "projects")
		const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" })
		if (!res.ok) return []
		const body = (await res.json()) as {
			data?: { projects?: { name: string; total_seconds: number }[] }
		}
		return (body.data?.projects ?? []).map((p) => ({
			name: p.name,
			totalSeconds: p.total_seconds,
		}))
	} catch {
		return []
	}
}

/** Refresh one link's cached total. Used by the sync job and on demand. */
export async function refreshLinkCache(linkId: string): Promise<HackatimeFetch> {
	const link = await prisma.hackatimeLink.findUnique({
		where: { id: linkId },
		include: { themeProject: { select: { user: { select: { hackatimeUserId: true } } } } },
	})
	if (!link) return { seconds: 0, stale: true, error: "link not found" }

	const hackatimeUserId = link.themeProject.user.hackatimeUserId
	if (!hackatimeUserId) {
		return { seconds: link.cachedSeconds ?? 0, stale: true, error: "user has no linked Hackatime account" }
	}

	const result = await fetchProjectSeconds(hackatimeUserId, link.hackatimeProject)
	if (result.stale) {
		await prisma.hackatimeLink.update({
			where: { id: linkId },
			data: { lastFetchError: result.error ?? "unknown error" },
		})
		// Fall back to the last good value rather than reporting zero.
		return { seconds: link.cachedSeconds ?? 0, stale: true, error: result.error }
	}

	await prisma.hackatimeLink.update({
		where: { id: linkId },
		data: { cachedSeconds: result.seconds, cachedAt: new Date(), lastFetchError: null },
	})
	return result
}
