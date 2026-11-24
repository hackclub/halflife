import { isRecord } from "@/lib/unknown"

/**
 * How much of a period was logged twice – once through a journal entry and once through a linked Hackatime project.
 *
 * Someone who codes with Hackatime running and records a Lapse timelapse of the same sitting has the same wall-clock minutes in two buckets: `journalHours` (their entry, with the recording as evidence) and `hackatimeHours` (the link's whole-project total). Both are added, so the same minutes are paid for twice.
 *
 * Lapse reports when a recording started and how long it ran, so a timelapse is a real wall-clock WINDOW. Hackatime is then asked how much of the linked project it tracked inside each window – its own stats for that span, not a comparison of intervals done here. Those seconds are what comes off the link. A recording with no project name, or another project's name, says nothing about this link and is left out.
 *
 * Everything here is seconds since the epoch and pure. The fetching lives in lib/hours; this is the half that decides which windows are asked about and which measured answers still stand, and it is driven directly by the contract checks.
 */

/**
 * A stretch of time, in seconds since the epoch. Half-open: [start, end).
 *
 * A type alias rather than an interface on purpose: these get written into Prisma's JSON columns, and `InputJsonValue` only accepts types with an implicit index signature, which interfaces do not have.
 */
// oxlint-disable-next-line typescript/consistent-type-definitions
export type Interval = {
	start: number
	end: number
}

/**
 * Collapse a set of intervals into the smallest equivalent set of disjoint, ascending intervals.
 *
 * Recordings can touch or overlap – two made back to back, one running into the next. The union is taken first so a minute covered by two windows is asked about once, not twice. Zero-length and backwards intervals are dropped: they are not time anybody spent.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
	const clean: Interval[] = intervals
		.filter(i => Number.isFinite(i?.start) && Number.isFinite(i?.end) && (i?.end ?? 0) > (i?.start ?? 0))
		.map(i => ({ end: i.end, start: i.start }))
		.toSorted((a, b) => a.start - b.start)
	const [first] = clean
	if (!first) return []

	const merged: Interval[] = [first]
	for (const next of clean.slice(1)) {
		const last = merged.at(-1)
		if (!last) continue
		if (next.start <= last.end) {
			if (next.end > last.end) last.end = next.end
		} else merged.push(next)
	}
	return merged
}

/**
 * Cap a subtraction at what is actually there to subtract from.
 *
 * Hackatime's stats can count a little more inside a window than the project total it reports for the link, so subtracting uncapped would drive a link's hours negative. A negative hour is worse than a duplicated one: it is a number nobody can explain on a review.
 */
export function capSubtraction(availableSeconds: number, overlap: number): number {
	const available = Number.isFinite(availableSeconds) ? Math.max(0, availableSeconds) : 0
	const wanted = Number.isFinite(overlap) ? Math.max(0, overlap) : 0
	return Math.min(available, wanted)
}

/**
 * The wall-clock window a timelapse covers, in seconds since the epoch.
 *
 * Lapse's `createdAt` is epoch MILLIseconds and its duration is wall-clock seconds, so the start is scaled and the two added. Null when the start was never stored: without it there is no window to ask Hackatime about, and inventing one from the row's own createdAt (when the clip was ATTACHED, which can be days later) would subtract somebody's Hackatime time for a sitting in the wrong week.
 */
export function timelapseWindow(recordedAtMs: number | Date | null, coveredSeconds: number | null): Interval | null {
	if (recordedAtMs === null || recordedAtMs === undefined) return null
	const start = recordedAtMs instanceof Date ? recordedAtMs.getTime() : recordedAtMs
	if (!Number.isFinite(start) || start < 0) return null
	if (
		coveredSeconds === null
		|| coveredSeconds === undefined
		|| !Number.isFinite(coveredSeconds)
		|| coveredSeconds <= 0
	)
		return null

	const startSeconds = start / 1000
	const duration = Math.round(coveredSeconds)
	return { end: startSeconds + duration, start: startSeconds }
}

/**
 * A recording window together with the Hackatime project Lapse saw while it ran.
 *
 * The window alone cannot say which link it belongs to. A clip attached to an entry in one week can carry tracked time that was linked on another week's project, and the projection that pairs the two is the recording's own `hackatimeProject` – stored at attach time for exactly this.
 */
export interface RecordedWindow {
	hackatimeProject: string | null
	window: Interval
}

/**
 * The recording windows a link's tracked time is measured against.
 *
 * A recording counts only when it names this link's Hackatime project, wherever it was journalled: in the same phase, another week, on a live entry or not at all. Its own `hackatimeProject` is the one fact that ties a sitting to the link its time arrives through. A recording that names no project, or another project's name, says nothing about this link and is left out.
 */
export function windowsForLink(recordings: readonly RecordedWindow[], hackatimeProject: string): Interval[] {
	if (!hackatimeProject) return []
	return recordings
		.filter(recording => recording.hackatimeProject === hackatimeProject)
		.map(recording => recording.window)
}

/**
 * The windows a link has to be measured for: `windowsForLink`, merged so that a minute covered by two recordings is asked about once.
 *
 * These are the keys the measurement is cached under, so they are NOT clipped to the link's week. Clipping happens when Hackatime is asked, because the week can move with an extension while the recordings stay the same.
 */
export function overlapWindowsFor(recordings: readonly RecordedWindow[], hackatimeProject: string): Interval[] {
	return mergeIntervals(windowsForLink(recordings, hackatimeProject))
}

/**
 * The part of a window a link's week counts, or null when the two do not meet.
 *
 * Hackatime's seconds for the link are only the seconds inside its week, so a recording made in another week must be asked about only inside this one. Without a week (warm-ups have none) the window stands as it is.
 */
export function clipWindow(window: Interval, week: { fromSeconds: number; toSeconds: number } | null): Interval | null {
	if (!week) return window
	const start = Math.max(window.start, week.fromSeconds)
	const end = Math.min(window.end, week.toSeconds)
	return end > start ? { end, start } : null
}

/**
 * One merged recording window, with the seconds Hackatime tracked inside it.
 *
 * `start` and `end` are the unclipped window the entry was measured for. A later read finds its entry by those bounds, so a recording added somewhere else that does not touch this window leaves it standing.
 */
// oxlint-disable-next-line typescript/consistent-type-definitions
export type MeasuredWindow = {
	end: number
	seconds: number
	start: number
}

/**
 * Read the measurements a link has cached, or null if they are not something this wrote.
 *
 * Strict on purpose: a row that does not parse is no measurement at all, so the overlap reads as unchecked rather than as a number somebody guessed.
 */
export function parseCachedOverlap(value: unknown): MeasuredWindow[] | null {
	if (!isRecord(value) || !Array.isArray(value.windows)) return null
	const measured: MeasuredWindow[] = []
	for (const row of value.windows) {
		if (!isRecord(row)) continue
		const { end, seconds, start } = row
		if (typeof start !== "number" || typeof end !== "number" || typeof seconds !== "number") continue
		if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(seconds)) continue
		if (end <= start || seconds < 0) continue
		measured.push({ end, seconds, start })
	}
	return measured
}

/**
 * The seconds a link's cached measurements say are tracked inside these windows, or null when any window was never measured.
 *
 * Null is "unchecked", not zero. A window with no measurement could carry the same minutes the recording already claimed, and nothing here can say whether it does.
 */
export function overlapFromCache(
	windows: readonly Interval[],
	measured: readonly MeasuredWindow[] | null,
): number | null {
	if (!measured) return null
	let total = 0
	for (const window of windows) {
		const hit = measured.find(m => m.start === window.start && m.end === window.end)
		if (!hit) return null
		total += hit.seconds
	}
	return total
}
