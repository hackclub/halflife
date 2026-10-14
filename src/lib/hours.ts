import "server-only"
import { HoursSource, Phase } from "@/app/generated/prisma/enums"
import { COINS_PER_HOUR, MAX_COINS_PER_PROJECT } from "@/lib/config/program"
import { getTierOrThrow, type TierId } from "@/lib/config/tiers"
import { fetchProjectSeconds, fetchProjectSpans } from "@/lib/hackatime"
import {
	cachedSpansCover,
	capSubtraction,
	type HackatimeSpan,
	type Interval,
	overlapSeconds,
	parseCachedSpans,
	spanWindowFor,
	timelapseWindow,
} from "@/lib/hours-overlap"
import { round2 } from "@/lib/money"
import prisma from "@/lib/prisma"

export type HoursBreakdown = {
	/** Sum over MANUAL sessions of (hoursApproved ?? hoursClaimed). */
	journalHours: number
	/** The same sum of hoursClaimed only, so the UI can show reviewer deflation. */
	journalHoursClaimed: number
	journalEntryCount: number

	hackatimeHours: number
	/** True when any link fell back to its cache. Blocks finalisation. */
	hackatimeStale: boolean
	/**
	 * Seconds taken back off Hackatime because a journal entry with a timelapse already claimed those same minutes. Reported so the number on the review page is explainable rather than just smaller than Hackatime says.
	 */
	hackatimeOverlapSeconds: number
	/**
	 * True when an overlap may exist but could not be checked – the spans fetch failed, or failed because the participant has Hackatime's public stats off. Deliberately NOT folded into `hackatimeStale`: that one blocks an approval outright, and a participant who turned public stats off must not become permanently unapprovable. It surfaces as a warning to be weighed.
	 */
	hackatimeOverlapUnknown: boolean

	/** Evidence only. Never part of any total. */
	timelapseSeconds: number
	/** timelapseSeconds / claimed seconds, clamped to [0, 1]. */
	timelapseCoverage: number

	/** journalHours + hackatimeHours. The reviewer's default. */
	computedTotal: number
	/** This phase's frozen hours on ThemeProject, once its review has landed. */
	frozenTotal: number | null
	/** frozenTotal ?? computedTotal. The number every caller should use. */
	effectiveHours: number
}

/**
 * Journal hours and Hackatime hours are additive. Timelapse is not.
 *
 * A timelapse is a recording *of* a session whose hours were already claimed, so adding its duration is a straight double-count. It surfaces instead as `timelapseCoverage` – a session claiming six hours with five hours of timelapse reads very differently from one with none.
 *
 * Journal and Hackatime can double-count too, which is what `WorkSession.hoursSource` exists to prevent: a HACKATIME_TRACKED session still exists as a journal entry and as evidence, but contributes zero hours because its time already arrives through the link.
 */
export async function getHoursBreakdown(
	themeProjectId: string,
	phase: Phase,
	opts: { live?: boolean } = {},
): Promise<HoursBreakdown> {
	const live = opts.live ?? false

	const [project, sessions, links] = await Promise.all([
		prisma.themeProject.findUnique({
			where: { id: themeProjectId },
			select: {
				approvedHours: true,
				designApprovedHours: true,
				user: { select: { hackatimeUserId: true } },
			},
		}),
		prisma.workSession.findMany({
			where: { themeProjectId, phase, deletedAt: null },
			select: {
				hoursClaimed: true,
				hoursApproved: true,
				hoursSource: true,
				timelapses: { select: { coveredSeconds: true, recordedAt: true } },
			},
		}),
		prisma.hackatimeLink.findMany({
			where: { themeProjectId, phase },
			select: {
				id: true,
				hackatimeProject: true,
				hoursApproved: true,
				cachedSeconds: true,
				cachedSpans: true,
			},
		}),
	])

	let journalHours = 0
	let journalHoursClaimed = 0
	let timelapseSeconds = 0
	// The wall-clock windows this phase's journal has already claimed through a recording. Collected first because it is what every link below is measured against.
	const journalWindows: Interval[] = []

	for (const s of sessions) {
		// A tracked entry contributes no journal time, and its timelapses must not land in a coverage ratio whose denominator excludes them either.
		if (s.hoursSource === HoursSource.HACKATIME_TRACKED) continue
		for (const t of s.timelapses) {
			timelapseSeconds += t.coveredSeconds ?? 0
			const window = timelapseWindow(t.recordedAt, t.coveredSeconds)
			if (window) journalWindows.push(window)
		}
		journalHours += s.hoursApproved ?? s.hoursClaimed
		journalHoursClaimed += s.hoursClaimed
	}

	let hackatimeHours = 0
	let hackatimeStale = false
	let hackatimeOverlapSeconds = 0
	let hackatimeOverlapUnknown = false
	const hackatimeUserId = project?.user.hackatimeUserId ?? null
	// Only a phase that tracks BOTH tools can have anything to deduplicate, and when it cannot there is nothing to fetch – the spans of a link nobody's timelapse could overlap are a request nobody needs.
	const dedupePossible = journalWindows.length > 0 && links.length > 0
	const spanWindow = spanWindowFor(journalWindows)
	const fromSeconds = spanWindow?.fromSeconds ?? 0
	const toSeconds = spanWindow?.toSeconds ?? 0

	for (const link of links) {
		// A reviewer override replaces the live value permanently, so there is nothing to fetch and nothing that can go stale. It is also a human decision made against a breakdown that already showed the overlap, so it stands untouched: the subtraction is for computed values.
		if (link.hoursApproved !== null) {
			hackatimeHours += link.hoursApproved
			continue
		}
		let linkSeconds = 0
		if (live && hackatimeUserId) {
			const result = await fetchProjectSeconds(hackatimeUserId, link.hackatimeProject)
			if (result.stale) {
				hackatimeStale = true
				linkSeconds = link.cachedSeconds ?? 0
			} else {
				linkSeconds = result.seconds
				await prisma.hackatimeLink.update({
					where: { id: link.id },
					data: { cachedSeconds: result.seconds, cachedAt: new Date(), lastFetchError: null },
				})
			}
		} else {
			if (link.cachedSeconds === null) hackatimeStale = true
			linkSeconds = link.cachedSeconds ?? 0
		}

		// Subtract the minutes this link counted that a journal entry with a recording already claimed. Without this the same sitting is paid twice.
		if (dedupePossible) {
			const spans = await resolveSpans(link, { live, hackatimeUserId, fromSeconds, toSeconds })
			if (spans.stale) {
				// Unknown, not zero: the honest answer here is that the overlap may exist. Nothing is subtracted, so the risk is the status quo double-count rather than an underpayment.
				hackatimeOverlapUnknown = true
				// Recorded only when a fetch was actually attempted. This runs on read paths too – the projects list breaks down every project – and a write per dashboard load to note a cache that was simply cold would be a great deal of write load for no new information.
				if (live) {
					await prisma.hackatimeLink.update({
						where: { id: link.id },
						data: { spansFetchError: spans.error ?? "unknown error" },
					})
				}
			} else {
				const overlap = capSubtraction(linkSeconds, overlapSeconds(journalWindows, spans.spans))
				if (overlap > 0) {
					hackatimeOverlapSeconds += overlap
					linkSeconds -= overlap
				}
				// Persisted only on a fresh fetch, and with the window they were fetched for rather than as a bare array: the next read has to know whether these spans cover the window it is being asked about, and a list cannot say. Re-writing a cache that was just read from would put a write on every read of this row.
				if (spans.fetched) {
					await prisma.hackatimeLink.update({
						where: { id: link.id },
						data: {
							cachedSpans: { from: fromSeconds, to: toSeconds, spans: spans.spans },
							spansFetchedAt: new Date(),
							spansFetchError: null,
						},
					})
				}
			}
		}

		hackatimeHours += linkSeconds / 3600
	}

	const claimedSeconds = journalHoursClaimed * 3600
	const computedTotal = round2(journalHours + hackatimeHours)
	// Each phase freezes its own hours. Reading the build's column for a design breakdown would report a design as already-frozen the moment its build was approved, and hand the reviewer the wrong phase's number.
	const frozenTotal = (phase === Phase.DESIGN ? project?.designApprovedHours : project?.approvedHours) ?? null

	return {
		journalHours: round2(journalHours),
		journalHoursClaimed: round2(journalHoursClaimed),
		journalEntryCount: sessions.length,
		hackatimeHours: round2(hackatimeHours),
		hackatimeStale,
		hackatimeOverlapSeconds,
		hackatimeOverlapUnknown,
		timelapseSeconds,
		timelapseCoverage: claimedSeconds > 0 ? Math.min(1, timelapseSeconds / claimedSeconds) : 0,
		computedTotal,
		frozenTotal,
		effectiveHours: frozenTotal ?? computedTotal,
	}
}

/**
 * One link's tracked intervals, from cache when the cache answers the question and from Hackatime when it does not.
 *
 * `stale` here means "unknown", not "empty" – and it is the distinction the whole dedupe rests on. Spans that say a project was tracked at no time in the window are a finding; spans nobody could fetch are not, and treating the two alike would either subtract nothing silently or subtract something invented.
 */
async function resolveSpans(
	link: { hackatimeProject: string; cachedSpans: unknown },
	opts: { live: boolean; hackatimeUserId: string | null; fromSeconds: number; toSeconds: number },
): Promise<{ spans: HackatimeSpan[]; stale: boolean; fetched: boolean; error?: string }> {
	const cached = parseCachedSpans(link.cachedSpans)
	if (cached && cachedSpansCover(cached, opts.fromSeconds, opts.toSeconds)) {
		return { spans: cached.spans, stale: false, fetched: false }
	}
	if (!opts.live || !opts.hackatimeUserId) {
		return {
			spans: [],
			stale: true,
			fetched: false,
			error: cached ? "cached spans do not cover this window" : "no cached spans",
		}
	}
	const result = await fetchProjectSpans(opts.hackatimeUserId, link.hackatimeProject, {
		fromSeconds: opts.fromSeconds,
		toSeconds: opts.toSeconds,
	})
	return { ...result, fetched: true }
}

/**
 * Warm the cached spans for a phase's links, best effort.
 *
 * Called when a timelapse is attached, off the response path. Without it the deduplicated number only appears once something forces a live fetch – which today means the approval itself, so a reviewer would open a submission, read one Hackatime total, and watch a different one get approved underneath them. Warming the cache when the window it depends on actually changes keeps the review screen and the decision showing the same number.
 *
 * Failures are swallowed on purpose: every failure mode of this already degrades to "the overlap could not be checked", which the approval path reports. Throwing would fail a journal entry over a problem that does not affect it.
 */
export async function refreshOverlapSpans(themeProjectId: string, phase: Phase): Promise<void> {
	try {
		const [project, sessions, links] = await Promise.all([
			prisma.themeProject.findUnique({
				where: { id: themeProjectId },
				select: { user: { select: { hackatimeUserId: true } } },
			}),
			prisma.workSession.findMany({
				where: { themeProjectId, phase, deletedAt: null, hoursSource: { not: HoursSource.HACKATIME_TRACKED } },
				select: { timelapses: { select: { coveredSeconds: true, recordedAt: true } } },
			}),
			prisma.hackatimeLink.findMany({
				where: { themeProjectId, phase, hoursApproved: null },
				select: { id: true, hackatimeProject: true },
			}),
		])
		const hackatimeUserId = project?.user.hackatimeUserId
		if (!hackatimeUserId || links.length === 0) return

		const windows = sessions.flatMap((s) =>
			s.timelapses.flatMap((t) => {
				const window = timelapseWindow(t.recordedAt, t.coveredSeconds)
				return window ? [window] : []
			}),
		)
		const spanWindow = spanWindowFor(windows)
		if (!spanWindow) return

		for (const link of links) {
			const result = await fetchProjectSpans(hackatimeUserId, link.hackatimeProject, spanWindow)
			await prisma.hackatimeLink.update({
				where: { id: link.id },
				data: result.stale
					? { spansFetchError: result.error ?? "unknown error" }
					: {
							cachedSpans: { from: spanWindow.fromSeconds, to: spanWindow.toSeconds, spans: result.spans },
							spansFetchedAt: new Date(),
							spansFetchError: null,
						},
			})
		}
	} catch {
		// A cache warm that failed is the same as one that never ran.
	}
}

/** One link's identity for warming: enough to ask Hackatime again and to decide whether it needs asking. */
export type SpansWarmTarget = {
	id: string
	themeProjectId: string
	phase: Phase
	hackatimeProject: string
	cachedSpans?: unknown
}

/**
 * Warm the span cache for a batch of links, for the scheduled sync.
 *
 * The deduplication rests entirely on cached spans, and until now only two moments ever wrote them: attaching a recording, and an approval that reads live. Every screen in between – the trail, the project page, the project cards – reads the cache, and finding it cold reports the same sitting twice with nothing on the page to say the check never ran. A participant who recorded while Lapse or Hackatime was briefly unreachable never got a warm cache at all, so their project showed the doubled total until they happened to be approved.
 *
 * Batched, because the sync walks every link every fifteen minutes and cannot afford a query each. The recording windows come back in one read for all the phases involved, and a Hackatime request is made only for a link that would otherwise answer from a cold cache or from one fetched for a narrower window than the one now being asked about.
 */
export async function warmLinkSpans(targets: readonly SpansWarmTarget[]): Promise<{ warmed: number; failed: number }> {
	if (targets.length === 0) return { warmed: 0, failed: 0 }
	const key = (projectId: string, phase: Phase) => `${projectId}/${phase}`
	const projectIds = [...new Set(targets.map((t) => t.themeProjectId))]

	const [sessions, projects] = await Promise.all([
		prisma.workSession.findMany({
			where: {
				deletedAt: null,
				// A HACKATIME_TRACKED entry claims nothing, so its recording is not one of the windows a link's time has to be measured against.
				hoursSource: { not: HoursSource.HACKATIME_TRACKED },
				OR: [...new Set(targets.map((t) => ({ themeProjectId: t.themeProjectId, phase: t.phase })))],
			},
			select: {
				themeProjectId: true,
				phase: true,
				timelapses: { select: { coveredSeconds: true, recordedAt: true } },
			},
		}),
		prisma.themeProject.findMany({
			where: { id: { in: projectIds } },
			select: { id: true, user: { select: { hackatimeUserId: true } } },
		}),
	])

	const windowsByPhase = new Map<string, Interval[]>()
	for (const s of sessions) {
		const k = key(s.themeProjectId, s.phase)
		const list = windowsByPhase.get(k) ?? []
		for (const t of s.timelapses) {
			const window = timelapseWindow(t.recordedAt, t.coveredSeconds)
			if (window) list.push(window)
		}
		windowsByPhase.set(k, list)
	}
	const userByProject = new Map(projects.map((p) => [p.id, p.user.hackatimeUserId]))

	let warmed = 0
	let failed = 0
	for (const target of targets) {
		const spanWindow = spanWindowFor(windowsByPhase.get(key(target.themeProjectId, target.phase)) ?? [])
		// No recording in this phase means nothing to deduplicate, and no request worth making.
		if (!spanWindow) continue
		const cached = parseCachedSpans(target.cachedSpans)
		// Already answers the question being asked: a cache fetched for a narrower window is not an answer, so only this exact case is skipped.
		if (cached && cachedSpansCover(cached, spanWindow.fromSeconds, spanWindow.toSeconds)) continue
		const hackatimeUserId = userByProject.get(target.themeProjectId)
		if (!hackatimeUserId) continue

		const result = await fetchProjectSpans(hackatimeUserId, target.hackatimeProject, spanWindow)
		if (result.stale) {
			failed += 1
			// Recorded, never used to decide anything. The next run tries again, and until it succeeds the reading is flagged as unchecked rather than quietly believed.
			await prisma.hackatimeLink
				.update({ where: { id: target.id }, data: { spansFetchError: result.error ?? "unknown error" } })
				.catch(() => undefined)
			continue
		}
		warmed += 1
		await prisma.hackatimeLink
			.update({
				where: { id: target.id },
				data: {
					cachedSpans: { from: spanWindow.fromSeconds, to: spanWindow.toSeconds, spans: result.spans },
					spansFetchedAt: new Date(),
					spansFetchError: null,
				},
			})
			.catch(() => undefined)
	}
	return { warmed, failed }
}

/**
 * The summation half of getHoursBreakdown, separated so a caller that has already loaded sessions and links in bulk can apply the SAME rules without issuing three more queries per project.
 *
 * Extracted rather than reimplemented: these rules decide what people are paid, and a second copy that drifts is a second answer to "how many hours is this".
 */
export type SessionRow = {
	hoursClaimed: number
	hoursApproved: number | null
	hoursSource: HoursSource
	/**
	 * The recording windows behind this entry, when it has any. A HACKATIME_TRACKED entry is ignored entirely – it claims nothing – so its timelapses are not read either.
	 */
	timelapses?: { recordedAt: Date | null; coveredSeconds: number | null }[]
}

export type LinkRow = {
	hoursApproved: number | null
	cachedSeconds: number | null
	/** The link's tracked intervals, as cached on the row. See parseCachedSpans. */
	cachedSpans?: unknown
}

/**
 * A stored hours figure, or zero when it is not a number.
 *
 * These decide what people are paid, and the rows come from Prisma selects that a caller can narrow – one that forgot `hoursApproved` hands over `undefined`, which is not `null`, so the override branch below would add it and turn the entire total into NaN. NaN is worse than a wrong number here because it is not visibly wrong: it renders as `NaNh` in exactly one place, silently, and the rest of the phase still looks plausible. A missing figure is read as zero, which is a defensible total rather than a broken one.
 */
function storedHours(value: number | null | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/** Whether a reviewer has set this link's hours by hand, which replaces the computed value outright. */
function isOverride(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value)
}

export function rollUpHours(
	sessions: readonly SessionRow[],
	links: readonly LinkRow[],
	frozenTotal: number | null,
): {
	journalHours: number
	hackatimeHours: number
	hackatimeOverlapSeconds: number
	/**
	 * True when this phase has a recording and at least one link whose tracked intervals could not be read – so the subtraction below did not run and the total still carries the overlap. The counterpart of `HoursBreakdown.hackatimeOverlapUnknown`, and for the same reason: a caller that shows this number cannot otherwise tell a deduplicated total from one that quietly was not.
	 */
	hackatimeOverlapUnknown: boolean
	computedTotal: number
	effectiveHours: number
} {
	let journalHours = 0
	const journalWindows: Interval[] = []
	for (const s of sessions) {
		// A HACKATIME_TRACKED session still exists as evidence but contributes zero: its time already arrives through the link.
		if (s.hoursSource === HoursSource.HACKATIME_TRACKED) continue
		journalHours += storedHours(s.hoursApproved ?? s.hoursClaimed)
		for (const t of s.timelapses ?? []) {
			const window = timelapseWindow(t.recordedAt, t.coveredSeconds)
			if (window) journalWindows.push(window)
		}
	}

	let hackatimeHours = 0
	let hackatimeOverlapSeconds = 0
	let hackatimeOverlapUnknown = false
	for (const link of links) {
		// A reviewer override is a human decision against a breakdown that already showed the overlap. Untouched, exactly as in getHoursBreakdown.
		if (isOverride(link.hoursApproved)) {
			hackatimeHours += link.hoursApproved
			continue
		}
		let seconds = storedHours(link.cachedSeconds)
		const cached = parseCachedSpans(link.cachedSpans)
		if (journalWindows.length > 0) {
			// Unknown, not zero. The link may well carry the same minutes the recording already claimed; nothing here can say, and reporting a deduplicated-looking total either way would be a lie.
			if (!cached) {
				hackatimeOverlapUnknown = true
			} else {
				const overlap = capSubtraction(seconds, overlapSeconds(journalWindows, cached.spans))
				hackatimeOverlapSeconds += overlap
				seconds -= overlap
			}
		}
		hackatimeHours += seconds / 3600
	}

	const computedTotal = round2(journalHours + hackatimeHours)
	return {
		journalHours: round2(journalHours),
		hackatimeHours: round2(hackatimeHours),
		hackatimeOverlapSeconds,
		hackatimeOverlapUnknown,
		computedTotal,
		effectiveHours: frozenTotal ?? computedTotal,
	}
}

/**
 * Coins a phase minted. Every coin is spendable on anything – the shop, or the printer goal – so there is a single pot and no locked fund.
 *
 * `banked` stays on the shape as a legacy field: rows minted before the pots were merged still carry a banked half, and the review reconcile zeroes that half out (moving it to spendable) the next time an old approval is re-decided. New mints always report it as zero.
 *
 * A type alias rather than an interface on purpose: this gets written into the audit row's JSON payload, and Prisma's `InputJsonValue` only accepts types with an implicit index signature, which interfaces do not have.
 */
export type CoinSplit = {
	/** Legacy locked half. Always zero on new mints. */
	banked: number
	/** Every coin earned. Spendable on anything. */
	spendable: number
	total: number
}

/**
 * Coins minted by an approved DESIGN phase.
 *
 * Two layers and the order matters:
 *
 * [0, fundingHours)   → dollars, not coins. The parts grant; it buys the BOM. [fundingHours, ∞)   → spendable coins, 5 per hour.
 *
 * The printer on the wall no longer sizes any of this: a tier decides how many hours the project itself eats, and everything past that is simply earned. What a machine asks per week is still paced in ./config/printers.ts, but that pace is guidance the goal tracker reads – warnings, never a second pot of money.
 *
 * Undershooting needs no special case: an approval below the funded line earns nothing and the participant falls behind their own pace, which is exactly what the goal tracker is for.
 *
 * Minted coins are capped, because `approvedHours` can come from a reviewer typing into a box and a fat-fingered 1000 should not mint five thousand coins.
 */
export function designCoinsFor(tierId: TierId | number, approvedHours: number): CoinSplit {
	const tier = getTierOrThrow(tierId)
	const beyondFunding = Math.max(0, approvedHours - tier.fundingHours)
	const spendable = earnCoins(beyondFunding)
	return { banked: 0, spendable, total: spendable }
}

/**
 * Coins minted by an approved BUILD phase.
 *
 * A build week has no BOM to pay for – the parts were bought with the design week's grant – so there is no funded block to clear and every hour earns 5 coins, spendable on anything.
 *
 * This half of the economy is what carries someone from what five design weeks earn to an actual printer: five build weeks at five hours is 125 coins, which is more than half the cheapest machine.
 */
export function buildCoinsFor(approvedHours: number): CoinSplit {
	const spendable = earnCoins(Math.max(0, approvedHours))
	return { banked: 0, spendable, total: spendable }
}

/**
 * Hours to coins, rounded UP and capped.
 *
 * Up rather than down because the budget sheet paces in fractional hours – the A1 Mini asks 4.64 a week – and coins are whole. Flooring 4.64 * 5 = 23.2 to 23 loses a coin a week, which over five design weeks leaves an A1 Mini saver one coin short of the machine they were told they were on track for. Rounding up costs a handful of coins and keeps the promise the goal tracker makes.
 *
 * Capped, because `approvedHours` can come from a reviewer typing into a box and a fat-fingered 1000 should not mint five thousand coins.
 */
function earnCoins(hours: number): number {
	return Math.min(Math.ceil(hours * COINS_PER_HOUR), MAX_COINS_PER_PROJECT)
}
