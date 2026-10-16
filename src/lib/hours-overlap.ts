/**
 * How much of a period was logged twice – once through a journal entry and once through a linked Hackatime project.
 *
 * Someone who codes with Hackatime running and records a Lapse timelapse of the same sitting has the same wall-clock minutes in two buckets: `journalHours` (their entry, with the recording as evidence) and `hackatimeHours` (the link's whole-project total). Both are added, so the same minutes are paid for twice.
 *
 * The two tools each know what the other did, which is what makes this exact rather than a guess:
 *
 * - Lapse reports when a recording started and how long it ran, so a timelapse is a real wall-clock WINDOW, not just a duration.
 * - Hackatime reports the project's tracked INTERVALS, so a link is a set of windows rather than one opaque number.
 *
 * The overlap of those two sets of windows is the double-counted time. Whatever the two buckets report beyond it is genuinely distinct work and is left alone.
 *
 * Everything here is seconds since the epoch and pure. This is the half of the rule that decides what people are paid, so it is separated from the fetching and the database and driven directly by the contract checks.
 */

/**
 * A stretch of time, in seconds since the epoch. Half-open: [start, end).
 *
 * A type alias rather than an interface on purpose, for the same reason `CoinSplit` is one in hours.ts: these get written into Prisma's JSON columns, and `InputJsonValue` only accepts types with an implicit index signature, which interfaces do not have.
 */
export type Interval = {
	start: number
	end: number
}

/**
 * A Hackatime span is one of these. Named so call sites say what they hold – a cached `HackatimeSpan[]` on a link reads as tracked intervals, where an `Interval[]` reads as arithmetic.
 */
export type HackatimeSpan = Interval

/**
 * Collapse a set of intervals into the smallest equivalent set of disjoint, ascending intervals.
 *
 * Timelapses and Hackatime spans both arrive as lists that can touch or overlap each other – two recordings made back to back, a span straddling a break. The union is taken first so an overlap is never counted twice merely because two windows described the same minute, and so the intersection below can walk both sides in one pass. Zero-length and backwards intervals are dropped: they are not time anybody spent.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
	const clean: Interval[] = intervals
		.filter(i => Number.isFinite(i?.start) && Number.isFinite(i?.end) && (i?.end ?? 0) > (i?.start ?? 0))
		.map(i => ({ end: i.end, start: i.start }))
		.sort((a, b) => a.start - b.start)
	const first = clean[0]
	if (!first) return []

	const merged: Interval[] = [first]
	for (const next of clean.slice(1)) {
		const last = merged[merged.length - 1]
		if (!last) continue
		if (next.start <= last.end) {
			if (next.end > last.end) last.end = next.end
		} else {
			merged.push(next)
		}
	}
	return merged
}

/**
 * Seconds covered by both sets – the time two tools counted once each.
 *
 * Both sides are merged first, so the answer is the size of the intersection of the two unions, counted once however many windows happened to describe it. Zero is the honest answer for "these two sets never touch", which is the common case: most people track with one tool or the other.
 */
export function overlapSeconds(a: readonly Interval[], b: readonly Interval[]): number {
	const left = mergeIntervals(a)
	const right = mergeIntervals(b)
	if (left.length === 0 || right.length === 0) return 0

	let total = 0
	let i = 0
	let j = 0
	// Both lists are disjoint and ascending, so one forward pass meets every overlapping pair exactly once.
	while (i < left.length && j < right.length) {
		const a = left[i]
		const b = right[j]
		if (!a || !b) break
		const start = Math.max(a.start, b.start)
		const end = Math.min(a.end, b.end)
		if (end > start) total += end - start

		// Advance whichever finishes first; the other may still overlap what follows it.
		if (a.end <= b.end) i += 1
		else j += 1
	}
	return total
}

/**
 * Cap a subtraction at what is actually there to subtract from.
 *
 * Hackatime's spans carry up to two minutes of padding after a gap that ends a span, so the spans of a project can add up to more than the project total the stats endpoint reports. Subtracting the overlap uncapped would drive a link's hours negative, and a negative hour is worse than a duplicated one: it is a number nobody can explain on a review.
 */
export function capSubtraction(availableSeconds: number, overlap: number): number {
	const available = Number.isFinite(availableSeconds) ? Math.max(0, availableSeconds) : 0
	const wanted = Number.isFinite(overlap) ? Math.max(0, overlap) : 0
	return Math.min(available, wanted)
}

/**
 * The wall-clock window a timelapse covers, in seconds since the epoch.
 *
 * Lapse's `createdAt` is epoch MILLIseconds and its duration is wall-clock seconds, so the start is scaled and the two added. Null when the start was never stored: without it there is no window to intersect, and inventing one from the row's own createdAt (when the clip was ATTACHED, which can be days later) would subtract somebody's Hackatime time for a sitting in the wrong week.
 */
export function timelapseWindow(recordedAtMs: number | Date | null, coveredSeconds: number | null): Interval | null {
	if (recordedAtMs === null || recordedAtMs === undefined) return null
	const start = recordedAtMs instanceof Date ? recordedAtMs.getTime() : recordedAtMs
	if (!Number.isFinite(start) || start < 0) return null
	if (!Number.isFinite(coveredSeconds ?? Number.NaN) || (coveredSeconds ?? 0) <= 0) return null

	const startSeconds = start / 1000
	const duration = Math.round(coveredSeconds as number)
	return { end: startSeconds + duration, start: startSeconds }
}

/**
 * The window of tracked time a cached span list was fetched for, alongside the spans themselves.
 *
 * The bounds are stored with the data because a bare list of spans cannot say what period it covers – and a cached answer to a NARROWER question than the one being asked is not an answer at all. Asked to check an overlap outside the window it was fetched for, the caller must refetch rather than conclude "no overlap" from spans that simply never covered those minutes.
 */
export type CachedSpans = {
	from: number
	to: number
	spans: Interval[]
}

/**
 * Read the JSON on a HackatimeLink back into spans, or null if it is not something this wrote.
 *
 * Strict on purpose. A shape this does not recognise is treated as no cache, which costs one refetch, rather than parsed leniently into spans that might overlap the wrong hours.
 */
export function parseCachedSpans(value: unknown): CachedSpans | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null
	const raw = value as { from?: unknown; to?: unknown; spans?: unknown }
	if (typeof raw.from !== "number" || typeof raw.to !== "number" || !Array.isArray(raw.spans)) return null

	const spans: Interval[] = []
	for (const row of raw.spans) {
		const start = (row as { start?: unknown } | null)?.start
		const end = (row as { end?: unknown } | null)?.end
		if (typeof start !== "number" || typeof end !== "number") continue
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
		spans.push({ end, start })
	}
	return { from: raw.from, spans, to: raw.to }
}

/** Whether a cached answer covers the window it is being used for. */
export function cachedSpansCover(cached: CachedSpans, from: number, to: number): boolean {
	return cached.from <= from && cached.to >= to
}

/**
 * A recording window together with the Hackatime project Lapse saw while it ran.
 *
 * The window alone cannot say which link it belongs to. A clip attached to a journal entry in one week can carry tracked time that was linked on another week's project, and the projection that pairs the two is the recording's own `hackatimeProject` – stored at attach time for exactly this.
 */
export type RecordedWindow = {
	hackatimeProject: string | null
	window: Interval
}

/**
 * Every recording window a link's tracked time is deduplicated against.
 *
 * Two sets, and both are needed:
 *
 * - The recordings beside the link in its own (project, phase), taken whatever Hackatime project they name: the span intersection below decides whether they overlap, exactly as it always has, and legacy rows carry no project name to match on.
 * - This maker's recordings ELSEWHERE that name this project. Without this set a sitting journalled in one week and tracked against a link in another was paid for on both sides: the recording was never compared to the link it was made under, because the two live on different rows.
 *
 * A recording that names a different project is deliberately left out of the second set. It may still intersect this link's spans by coincidence, but the maker told us which project was being tracked while it ran, and subtracting against the wrong one is an underpayment dressed up as deduplication.
 */
export function windowsForLink(
	ownPhase: readonly Interval[],
	elsewhere: readonly RecordedWindow[],
	hackatimeProject: string,
): Interval[] {
	const windows: Interval[] = [...ownPhase]
	for (const recording of elsewhere) {
		if (recording.hackatimeProject === hackatimeProject) windows.push(recording.window)
	}
	return windows
}

/**
 * The window worth asking Hackatime about: the span of every recording window, with an hour of slack either side for clock disagreement between a laptop and Hackatime's servers. Anything outside this cannot overlap anything the journal claims, so it is not worth the response.
 */
export function spanWindowFor(windows: readonly Interval[]): { fromSeconds: number; toSeconds: number } | null {
	if (windows.length === 0) return null
	let from = Number.POSITIVE_INFINITY
	let to = Number.NEGATIVE_INFINITY
	for (const w of windows) {
		if (w.start < from) from = w.start
		if (w.end > to) to = w.end
	}
	if (!Number.isFinite(from) || !Number.isFinite(to)) return null
	const slack = 3600
	return { fromSeconds: Math.floor(from - slack), toSeconds: Math.ceil(to + slack) }
}
