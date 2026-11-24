import "server-only"
import { z } from "zod"
import { scheduledWeekFor } from "@/lib/config/program"
import type { Phase, Theme } from "@/lib/enums"
import { fetchWithRetry } from "@/lib/fetch-retry"
import db from "@/lib/prisma8"
import { effectiveWeekClose, getProgramSettings, weekClosesAt, weekDateRange } from "@/lib/program"
import { formatDbTimestamp, parseNullableTimestamp } from "@/lib/time"
import { isRecord } from "@/lib/unknown"

const BASE = process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"
const TIMEOUT_MS = 10_000

export interface HackatimeFetch {
	error?: string
	/**
	 * True when Hackatime answered and the named project is not in its list – the project was renamed or deleted. The approval path must treat this as "we don't know", never as a fresh zero.
	 */
	notFound?: boolean
	seconds: number
	/** True when the number came from cache or a failure, not a live fetch. */
	stale: boolean
}

/** The project list `GET /api/v1/users/:id/stats` returns, for the picker. */
const StatsProjectsBody = z.object({
	data: z
		.object({ projects: z.array(z.object({ name: z.string(), total_seconds: z.number() })).optional() })
		.optional(),
})

/**
 * Read one project's seconds out of a Hackatime stats response.
 *
 * Pure so the contract can be pinned without a network: a project that is present with zero seconds is the ONLY live zero. A name missing from a successfully fetched list means the project was renamed or deleted, and reporting zero for it would silently underpay the hand-in the number is about. A response with no usable project list is stale too – a shape change must not look like "nothing logged".
 *
 * Hackatime can list two projects under one name – it does for "Other" – and a link is stored by name, so their time is one clock and is added together. That is the same merge the picker does in `projectsByName`; reading only the first match here would make the linked figure smaller than the option the maker picked.
 */
export function projectSecondsFrom(body: unknown, project: string): HackatimeFetch {
	const data = isRecord(body) ? body.data : null
	const projects = isRecord(data) ? data.projects : null
	if (!Array.isArray(projects)) return { error: "Hackatime returned no project list", seconds: 0, stale: true }

	const matches = projects.filter((p): p is { [_: string]: unknown } => isRecord(p) && p.name === project)
	if (matches.length === 0)
		return {
			error: `Hackatime does not list a project named "${project}"`,
			notFound: true,
			seconds: 0,
			stale: true,
		}

	let seconds = 0
	for (const match of matches) {
		const total = match.total_seconds
		if (typeof total === "number" && Number.isFinite(total)) seconds += Math.max(0, total)
	}
	return { seconds, stale: false }
}

/**
 * Returns `{ seconds, stale }` rather than a bare number on purpose.
 *
 * Stasis's client returns 0 on any error including a timeout, and that zero flows straight into the hours field on the grant row with no signal. A blip during an approval silently underpays someone. Here the caller can tell the difference between "genuinely zero" and "we don't know", and the approval path refuses to finalise on "we don't know".
 *
 * Pass `window` to count only time in that span (a phase's scheduled week): without it the endpoint returns the project's all-time total, which is what let one block of tracked time back every theme and warm-up at once. Hackatime's stats endpoint honours `start_date`/`end_date` (see its StatsController); when the week is unknown (warm-up, week 0) omit the window and the all-time total is returned, with cross-project uniqueness as the remaining guard.
 */
export async function fetchProjectSeconds(
	hackatimeUserId: string,
	project: string,
	window?: { fromSeconds: number; toSeconds: number },
): Promise<HackatimeFetch> {
	try {
		const url = new URL(`${BASE}/api/v1/users/${encodeURIComponent(hackatimeUserId)}/stats`)
		url.searchParams.set("features", "projects")
		// Hackatime parses these with Time.zone.parse, so an ISO instant is unambiguous where a bare date would be read in the server's zone.
		if (window) {
			url.searchParams.set("start_date", new Date(window.fromSeconds * 1000).toISOString())
			url.searchParams.set("end_date", new Date(window.toSeconds * 1000).toISOString())
		}
		const res = await fetchWithRetry(url, {
			cache: "no-store",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		if (!res.ok) return { error: `HTTP ${res.status}`, seconds: 0, stale: true }

		return projectSecondsFrom(await res.json(), project)
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err), seconds: 0, stale: true }
	}
}

/**
 * The project list for the picker, scoped to a phase's week when one is given.
 *
 * The picker has to quote the same number the link will store: without the window it shows the project's all-time total while the link counts only its scheduled week, so the option and the linked row disagree the moment somebody picks it.
 */
export async function listUserProjects(
	hackatimeUserId: string,
	window?: { fromSeconds: number; toSeconds: number },
): Promise<{ name: string; totalSeconds: number }[]> {
	try {
		const url = new URL(`${BASE}/api/v1/users/${encodeURIComponent(hackatimeUserId)}/stats`)
		url.searchParams.set("features", "projects")
		if (window) {
			url.searchParams.set("start_date", new Date(window.fromSeconds * 1000).toISOString())
			url.searchParams.set("end_date", new Date(window.toSeconds * 1000).toISOString())
		}
		const res = await fetchWithRetry(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) })
		if (!res.ok) return []
		const parsed = StatsProjectsBody.safeParse(await res.json())
		if (!parsed.success) return []
		return projectsByName(parsed.data.data?.projects ?? [])
	} catch {
		return []
	}
}

/**
 * One entry per project name, with the time under that name added together.
 *
 * Hackatime's stats endpoint can report two projects under one name – it does for "Other" – and a link is stored by name, so the two are one clock here. Merging them also keeps the picker to one option per link, rather than two indistinguishable choices that React would give the same key.
 */
export function projectsByName(
	projects: { name: string; total_seconds: number }[],
): { name: string; totalSeconds: number }[] {
	const merged = new Map<string, number>()
	for (const project of projects) merged.set(project.name, (merged.get(project.name) ?? 0) + project.total_seconds)
	return [...merged].map(([name, totalSeconds]) => ({ name, totalSeconds }))
}

export interface PhaseWeekExtensions {
	projectUntil?: Date | null
	userUntil?: Date | null
	weekUntil?: Date | null
}

/**
 * The seconds window a Hackatime link counts, `[fromSeconds, toSeconds]`, in the program timezone.
 *
 * Pure version of `phaseWeekWindow`'s arithmetic: the scheduled week start, and the earliest close an extension
 * pushes past. Kept apart so the window rule itself can be pinned without a database.
 */
export function phaseWeekWindowSeconds(
	settings: { eventStartDate: Date; programTimezone: string },
	theme: Theme,
	phase: Phase,
	extensions: PhaseWeekExtensions,
): { fromSeconds: number; toSeconds: number } | null {
	const week = scheduledWeekFor(theme, phase)
	if (week < 1) return null
	const range = weekDateRange(settings, week)
	if (!range) return null
	// Never narrower than the scheduled close: a granted extension only widens the window.
	const close = effectiveWeekClose(
		weekClosesAt(settings, week),
		extensions.userUntil,
		extensions.projectUntil,
		extensions.weekUntil,
	)
	return { fromSeconds: Math.floor(range.start.getTime() / 1000), toSeconds: Math.floor(close.getTime() / 1000) }
}

/**
 * The seconds window a phase's Hackatime link counts, extensions included when they apply.
 *
 * The picker's prices and a replayed link both come from here, so a maker whose extension runs past the scheduled
 * Sunday sees the same tracked hours when the maker picks, when the cache refreshes and when the decision freezes
 * them. Without a user/project to look extensions up for, the scheduled window alone stands.
 */
export async function phaseWeekWindow(
	theme: Theme,
	phase: Phase,
	userId?: string,
	projectId?: string,
): Promise<{ fromSeconds: number; toSeconds: number } | null> {
	const settings = await getProgramSettings()
	if (!userId || !projectId) return phaseWeekWindowSeconds(settings, theme, phase, {})
	const [user, project, weekExtension] = await Promise.all([
		db.orm.public.User.whereUnique({ id: userId }).select("submissionExtensionUntil").first(),
		db.orm.public.ThemeProject.whereUnique({ id: projectId }).select("submissionExtensionUntil").first(),
		db.orm.public.WeekExtension.whereUnique({ userId, week: scheduledWeekFor(theme, phase) })
			.select("submissionExtensionUntil")
			.first(),
	])
	return phaseWeekWindowSeconds(settings, theme, phase, {
		projectUntil: project?.submissionExtensionUntil ? parseNullableTimestamp(project.submissionExtensionUntil) : null,
		userUntil: user?.submissionExtensionUntil ? parseNullableTimestamp(user.submissionExtensionUntil) : null,
		weekUntil: weekExtension?.submissionExtensionUntil
			? parseNullableTimestamp(weekExtension.submissionExtensionUntil)
			: null,
	})
}

/** Refresh one link's cached total. Used by the sync job and on demand. */
export async function refreshLinkCache(linkId: string): Promise<HackatimeFetch> {
	const link = await db.orm.public.HackatimeLink.whereUnique({ id: linkId })
		.include("themeProject", project => project.include("user", user => user.select("hackatimeUserId")))
		.first()
	if (!link?.themeProject?.user) return { error: "link not found", seconds: 0, stale: true }

	const { hackatimeUserId } = link.themeProject.user
	if (!hackatimeUserId)
		return { error: "user has no linked Hackatime account", seconds: link.cachedSeconds ?? 0, stale: true }

	// Week-scoped, like every other read of a link's seconds: caching the all-time total here would reintroduce the double-count the link route scopes out, one sync run later.
	const window = await phaseWeekWindow(
		link.themeProject.theme,
		link.phase,
		link.themeProject.userId,
		link.themeProjectId,
	)
	const result = await fetchProjectSeconds(hackatimeUserId, link.hackatimeProject, window ?? undefined)
	if (result.stale) {
		await db.orm.public.HackatimeLink.where({ id: linkId }).update({
			lastFetchError: result.error ?? "unknown error",
		})
		// Fall back to the last good value rather than reporting zero.
		return { error: result.error, seconds: link.cachedSeconds ?? 0, stale: true }
	}

	await db.orm.public.HackatimeLink.where({ id: linkId }).update({
		cachedAt: formatDbTimestamp(new Date()),
		cachedSeconds: result.seconds,
		lastFetchError: null,
	})
	return result
}
