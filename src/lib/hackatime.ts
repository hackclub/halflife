import "server-only"
import { fetchWithRetry } from "@/lib/fetch-retry"
import type { HackatimeSpan } from "@/lib/hours-overlap"
import prisma from "@/lib/prisma"

const BASE = process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"
const TIMEOUT_MS = 10_000

export type HackatimeFetch = {
	seconds: number
	/** True when the number came from cache or a failure, not a live fetch. */
	stale: boolean
	error?: string
	/**
	 * True when Hackatime answered and the named project is not in its list – the project was renamed or deleted. The approval path must treat this as "we don't know", never as a fresh zero.
	 */
	notFound?: boolean
}

type StatsBody = {
	data?: { projects?: { name?: unknown; total_seconds?: unknown }[] }
}

/**
 * Read one project's seconds out of a Hackatime stats response.
 *
 * Pure so the contract can be pinned without a network: a project that is present with zero seconds is the ONLY live zero. A name missing from a successfully fetched list means the project was renamed or deleted, and reporting zero for it would silently underpay the hand-in the number is about. A response with no usable project list is stale too – a shape change must not look like "nothing logged".
 */
export function projectSecondsFrom(body: unknown, project: string): HackatimeFetch {
	const projects = (body as StatsBody | null)?.data?.projects
	if (!Array.isArray(projects)) {
		return { seconds: 0, stale: true, error: "Hackatime returned no project list" }
	}

	const match = projects.find(p => p?.name === project)
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
 * Stasis's client returns 0 on any error including a timeout, and that zero flows straight into the hours field on the grant row with no signal. A blip during an approval silently underpays someone. Here the caller can tell the difference between "genuinely zero" and "we don't know", and the approval path refuses to finalise on "we don't know".
 */
export async function fetchProjectSeconds(hackatimeUserId: string, project: string): Promise<HackatimeFetch> {
	try {
		const url = new URL(`${BASE}/api/v1/users/${encodeURIComponent(hackatimeUserId)}/stats`)
		url.searchParams.set("features", "projects")
		const res = await fetchWithRetry(url, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			cache: "no-store",
		})
		if (!res.ok) return { seconds: 0, stale: true, error: `HTTP ${res.status}` }

		return projectSecondsFrom(await res.json(), project)
	} catch (err) {
		return { seconds: 0, stale: true, error: err instanceof Error ? err.message : String(err) }
	}
}

/**
 * Read a project's tracked intervals out of a Hackatime spans response.
 *
 * The counterpart to `projectSecondsFrom`, and for the same reason: approval reads this live, and the difference between "no overlap" and "we could not find out" decides whether somebody is paid for the same minutes twice or once. A response with no spans array is therefore stale, never an empty answer – an empty array IS a real answer here, meaning the project was tracked at no time in the window, and the two must not be confused.
 *
 * Malformed rows are dropped rather than failing the whole read: one bad span should cost that span, not the participant's hours. Times are seconds.
 */
export function spansFrom(body: unknown): { spans: HackatimeSpan[]; stale: boolean; error?: string } {
	const raw = (body as { spans?: unknown } | null)?.spans
	if (!Array.isArray(raw)) {
		return { spans: [], stale: true, error: "Hackatime returned no spans" }
	}

	const spans: HackatimeSpan[] = []
	for (const row of raw) {
		const start = (row as { start_time?: unknown })?.start_time
		const end = (row as { end_time?: unknown })?.end_time
		if (
			typeof start !== "number" ||
			typeof end !== "number" ||
			!Number.isFinite(start) ||
			!Number.isFinite(end) ||
			end <= start
		) {
			continue
		}
		spans.push({ start, end })
	}
	return { spans, stale: false }
}

/**
 * Fetch the intervals a project was tracked for, over a window.
 *
 * This is what makes deduplication exact. `fetchProjectSeconds` answers "how much"; the spans answer "when", and only "when" can be compared against a timelapse's recording window.
 *
 * The window is always passed explicitly. Left to its default it would ask for ten years of heartbeats, which is a response nobody should page in on an approval path.
 *
 * Unauthenticated on purpose, like `fetchProjectSeconds`: Hackatime serves these public-stats lookups to anyone while a participant has public stats enabled (the default), and the alternative is asking every maker to hand us a token we would then have to store and refresh.
 */
export async function fetchProjectSpans(
	hackatimeUserId: string,
	project: string,
	window: { fromSeconds: number; toSeconds: number },
): Promise<{ spans: HackatimeSpan[]; stale: boolean; error?: string }> {
	try {
		const url = new URL(`${BASE}/api/v1/users/${encodeURIComponent(hackatimeUserId)}/heartbeats/spans`)
		url.searchParams.set("project", project)
		// Hackatime parses these with Time.zone.parse, so an ISO instant is unambiguous where a bare date would be read in the server's zone.
		url.searchParams.set("start_date", new Date(window.fromSeconds * 1000).toISOString())
		url.searchParams.set("end_date", new Date(window.toSeconds * 1000).toISOString())
		const res = await fetchWithRetry(url, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			cache: "no-store",
		})
		// 403 is a participant who turned public stats off. That is not a transient blip and must not read as "no overlap found".
		if (!res.ok) return { spans: [], stale: true, error: `HTTP ${res.status}` }

		return spansFrom(await res.json())
	} catch (err) {
		return { spans: [], stale: true, error: err instanceof Error ? err.message : String(err) }
	}
}

export async function listUserProjects(hackatimeUserId: string): Promise<{ name: string; totalSeconds: number }[]> {
	try {
		const url = new URL(`${BASE}/api/v1/users/${encodeURIComponent(hackatimeUserId)}/stats`)
		url.searchParams.set("features", "projects")
		const res = await fetchWithRetry(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" })
		if (!res.ok) return []
		const body = (await res.json()) as {
			data?: { projects?: { name: string; total_seconds: number }[] }
		}
		return (body.data?.projects ?? []).map(p => ({
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
