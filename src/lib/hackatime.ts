import "server-only"
import prisma from "@/lib/prisma"

const BASE = process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"
const TIMEOUT_MS = 10_000

export interface HackatimeFetch {
  seconds: number
  /** True when the number came from cache or a failure, not a live fetch. */
  stale: boolean
  error?: string
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

    const body = (await res.json()) as {
      data?: { projects?: { name: string; total_seconds: number }[] }
    }
    const match = body.data?.projects?.find((p) => p.name === project)
    return { seconds: match?.total_seconds ?? 0, stale: false }
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
