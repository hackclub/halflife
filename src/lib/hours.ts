import "server-only"
import { COINS_PER_HOUR, MAX_COINS_PER_PROJECT } from "@/lib/config/program"
import { getTierOrThrow } from "@/lib/config/tiers"
import { HoursSource, Phase } from "@/lib/enums"
import { fetchProjectSeconds, phaseWeekWindow } from "@/lib/hackatime"
import {
	capSubtraction,
	clipWindow,
	type Interval,
	type MeasuredWindow,
	overlapFromCache,
	overlapWindowsFor,
	parseCachedOverlap,
	type RecordedWindow,
	timelapseWindow,
} from "@/lib/hours-overlap"
import { round2 } from "@/lib/money"
import db, { type DbOrTx } from "@/lib/prisma8"
import { formatDbTimestamp, parseNullableTimestamp } from "@/lib/time"

export interface HoursBreakdown {
	/** journalHours + hackatimeHours. The reviewer's default. */
	computedTotal: number
	/** frozenTotal ?? computedTotal. The number every caller should use. */
	effectiveHours: number
	/** This phase's frozen hours on ThemeProject, once its review has landed. */
	frozenTotal: number | null

	hackatimeHours: number
	/**
	 * Seconds taken back off Hackatime because a Lapse recording of the same sitting already sits under this link's project. Reported so the number on the review page is explainable rather than just smaller than Hackatime says.
	 */
	hackatimeOverlapSeconds: number
	/**
	 * True when an overlap may exist but Hackatime could not be asked about it – the stats call failed, or failed because the participant has Hackatime's public stats off. Deliberately NOT folded into `hackatimeStale`: that one blocks an approval outright, and a participant who turned public stats off must not become permanently unapprovable. It surfaces as a warning to be weighed.
	 */
	hackatimeOverlapUnknown: boolean
	/** True when any link fell back to its cache. Blocks finalisation. */
	hackatimeStale: boolean
	journalEntryCount: number
	/** Sum over MANUAL sessions of (hoursApproved ?? hoursClaimed). */
	journalHours: number
	/** The same sum of hoursClaimed only, so the UI can show reviewer deflation. */
	journalHoursClaimed: number
	/** timelapseSeconds / claimed seconds, clamped to [0, 1]. */
	timelapseCoverage: number

	/** Evidence only. Never part of any total. */
	timelapseSeconds: number
}

/**
 * Journal hours and Hackatime hours are additive. Timelapse is not.
 *
 * A timelapse is a recording *of* a session whose hours were already claimed, so adding its duration is a straight double-count. It surfaces instead as `timelapseCoverage` – a session claiming six hours with five hours of timelapse reads very differently from one with none.
 *
 * Hackatime time under a Lapse recording comes off the link whatever the entry is. A recording on a live MANUAL entry is the maker's claim, counted there. A recording on a tracked entry, or on a deleted one, is not a devlog: its sitting is not claimed through the journal, so the Hackatime time it was filmed over does not count either. The tracked time has to be shown with a devlog, and a Lapse clip with no devlog is not verifiable.
 *
 * `client` runs the reads on a transaction instead of the shared pool, which is how the decision path reads the total it freezes under the maker's credit lock: the number that ends up frozen has to be the one read while nothing else can be rewriting the rows behind it. The live Hackatime fetches stay outside any transaction – they are network I/O with a ten second timeout and retries, and holding a connection (and a lock) open for them would be far worse than the race it closes.
 */
export async function getHoursBreakdown(
	themeProjectId: string,
	phase: Phase,
	opts: { client?: DbOrTx; live?: boolean } = {},
): Promise<HoursBreakdown> {
	const live = opts.live ?? false
	const client: DbOrTx = opts.client ?? db

	const [project, sessions, links] = await Promise.all([
		client.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
			.select("approvedHours", "designApprovedHours", "theme", "userId")
			.include("user", user => user.select("hackatimeUserId"))
			.first(),
		client.orm.public.WorkSession.where({ deletedAt: null, phase, themeProjectId })
			.select("hoursApproved", "hoursClaimed", "hoursSource")
			.include("timelapses", timelapse => timelapse.select("coveredSeconds"))
			.all(),
		client.orm.public.HackatimeLink.where({ phase, themeProjectId })
			.select("cachedOverlap", "cachedSeconds", "hackatimeProject", "hoursApproved", "id")
			.all(),
	])

	let journalHours = 0
	let journalHoursClaimed = 0
	let timelapseSeconds = 0
	for (const s of sessions) {
		// A tracked entry contributes no journal time, and its timelapses must not land in a coverage ratio whose denominator excludes them either.
		if (s.hoursSource === HoursSource.HACKATIME_TRACKED) continue
		for (const t of s.timelapses) timelapseSeconds += t.coveredSeconds ?? 0
		journalHours += s.hoursApproved ?? s.hoursClaimed
		journalHoursClaimed += s.hoursClaimed
	}

	let hackatimeHours = 0
	let hackatimeStale = false
	let hackatimeOverlapSeconds = 0
	let hackatimeOverlapUnknown = false
	if (project && !project.user) throw new Error(`project ${themeProjectId} has no owner`)
	const hackatimeUserId = project?.user?.hackatimeUserId ?? null
	// Week-scoped like the link route: the live re-read must answer the same question the link was created with, or a refresh would silently swap the week's hours for the all-time total. Warm-ups keep the all-time total (no week to scope to).
	const liveWindow =
		live && hackatimeUserId && project
			? await phaseWeekWindow(project.theme, phase, project.userId, themeProjectId)
			: null
	// Every Lapse recording this maker holds under a Hackatime project name, from any project, phase and entry state. A link's overlap is measured against all of them, because a sitting filmed in one week can be tracked on a link in another.
	const recordings = links.length === 0 || !project ? [] : await makerRecordings(client, project.userId)

	for (const link of links) {
		// A reviewer override replaces the live value permanently, so there is nothing to fetch and nothing that can go stale. It is also a human decision made against a breakdown that already showed the overlap, so it stands untouched: the subtraction is for computed values.
		if (link.hoursApproved !== null) {
			hackatimeHours += link.hoursApproved
			continue
		}
		let linkSeconds = 0
		if (live && hackatimeUserId) {
			const result = await fetchProjectSeconds(hackatimeUserId, link.hackatimeProject, liveWindow ?? undefined)
			if (result.stale) {
				hackatimeStale = true
				linkSeconds = link.cachedSeconds ?? 0
			} else {
				linkSeconds = result.seconds
				await client.orm.public.HackatimeLink.where({ id: link.id }).update({
					cachedAt: formatDbTimestamp(new Date()),
					cachedSeconds: result.seconds,
					lastFetchError: null,
				})
			}
		} else {
			if (link.cachedSeconds === null) hackatimeStale = true
			linkSeconds = link.cachedSeconds ?? 0
		}

		// Subtract the minutes this link counted that a Lapse recording of the same sitting already covers. Without this the same sitting is paid twice, or paid as Hackatime time with no devlog behind it. A link with no recording naming it has nothing to compare, and no request to make.
		const windows = overlapWindowsFor(recordings, link.hackatimeProject)
		let overlap: number | null = null
		if (windows.length > 0) {
			if (live && hackatimeUserId) {
				const measured = await measureOverlap(hackatimeUserId, link.hackatimeProject, windows, liveWindow)
				overlap = measured.error ? null : sumSeconds(measured.windows)
				await client.orm.public.HackatimeLink.where({ id: link.id }).update(
					measured.error
						? { overlapFetchError: measured.error }
						: {
								cachedOverlap: { windows: measured.windows },
								overlapFetchError: null,
								overlapFetchedAt: formatDbTimestamp(new Date()),
							},
				)
			} else overlap = overlapFromCache(windows, parseCachedOverlap(link.cachedOverlap))
			// Unknown, not zero: the link may well carry the same minutes a recording covers, and nothing here can say. Nothing is subtracted, so the risk is the status quo double count rather than an underpayment.
			if (overlap === null) hackatimeOverlapUnknown = true
		}
		if (overlap !== null) {
			const subtracted = capSubtraction(linkSeconds, overlap)
			hackatimeOverlapSeconds += subtracted
			linkSeconds -= subtracted
		}

		hackatimeHours += linkSeconds / 3600
	}

	const claimedSeconds = journalHoursClaimed * 3600
	const computedTotal = round2(journalHours + hackatimeHours)
	// Each phase freezes its own hours. Reading the build's column for a design breakdown would report a design as already-frozen the moment its build was approved, and hand the reviewer the wrong phase's number.
	const frozenTotal = (phase === Phase.DESIGN ? project?.designApprovedHours : project?.approvedHours) ?? null

	return {
		computedTotal,
		effectiveHours: frozenTotal ?? computedTotal,
		frozenTotal,
		hackatimeHours: round2(hackatimeHours),
		hackatimeOverlapSeconds,
		hackatimeOverlapUnknown,
		hackatimeStale,
		journalEntryCount: sessions.length,
		journalHours: round2(journalHours),
		journalHoursClaimed: round2(journalHoursClaimed),
		timelapseCoverage: claimedSeconds > 0 ? Math.min(1, timelapseSeconds / claimedSeconds) : 0,
		timelapseSeconds,
	}
}

/**
 * Every Lapse recording this maker holds under a Hackatime project name, with the window it covers.
 *
 * Nothing filters on the entry here. A recording's Hackatime time comes off the link whether its entry is live, deleted, or a tracked entry that claims nothing (see getHoursBreakdown). Ari pulls the same clips by project name, so this is the set the two platforms have to agree on.
 */
export async function makerRecordings(client: DbOrTx, userId: string): Promise<RecordedWindow[]> {
	return (await recordingsByOwner(client, [userId])).get(userId) ?? []
}

/**
 * The recordings of many makers at once, keyed by owner: `makerRecordings` for a batch.
 *
 * `userIds` scopes the read. Null reads every maker, for the admin reports that cover the whole programme. Entries are not filtered by state, for the reason in `makerRecordings`.
 */
export async function recordingsByOwner(
	client: DbOrTx,
	userIds: readonly string[] | null,
): Promise<Map<string, RecordedWindow[]>> {
	const withRecording = client.orm.public.WorkSession.where(session =>
		session.timelapses.some(timelapse => timelapse.hackatimeProject.isNotNull()),
	)
	const sessions = await (userIds
		? withRecording.where(session => session.themeProject.some(project => project.userId.in(userIds)))
		: withRecording
	)
		.select("id")
		.include("themeProject", project => project.select("userId"))
		.include("timelapses", timelapse =>
			timelapse.select("coveredSeconds", "hackatimeProject", "provider", "recordedAt"),
		)
		.all()

	const byOwner = new Map<string, RecordedWindow[]>()
	for (const s of sessions) {
		if (!s.themeProject) throw new Error(`session ${s.id} has no project`)
		const made = byOwner.get(s.themeProject.userId) ?? []
		for (const t of s.timelapses) {
			if (t.provider !== "lapse" || !t.hackatimeProject) continue
			const window = timelapseWindow(parseNullableTimestamp(t.recordedAt), t.coveredSeconds)
			if (window) made.push({ hackatimeProject: t.hackatimeProject, window })
		}
		byOwner.set(s.themeProject.userId, made)
	}
	return byOwner
}

/**
 * Ask Hackatime how much of a project it tracked inside each window, clipped to the week the link counts.
 *
 * This is the deduplication itself: Hackatime is the one that says how many of a project's seconds fall inside a recording, rather than this file intersecting its own copy of the project's spans with the recording. Each window is one stats request, and the answers are kept per window so a later read can tell which windows it already knows.
 *
 * Stops at the first failure and returns no windows: a partial measurement would subtract some of a recording's time and not the rest, which is worse than none.
 */
async function measureOverlap(
	hackatimeUserId: string,
	project: string,
	windows: readonly Interval[],
	week: { fromSeconds: number; toSeconds: number } | null,
): Promise<{ error?: string; windows: MeasuredWindow[] }> {
	const measured: MeasuredWindow[] = []
	for (const window of windows) {
		const clipped = clipWindow(window, week)
		if (!clipped) {
			measured.push({ end: window.end, seconds: 0, start: window.start })
			continue
		}
		const result = await fetchProjectSeconds(hackatimeUserId, project, {
			fromSeconds: clipped.start,
			toSeconds: clipped.end,
		})
		if (result.stale) return { error: result.error ?? "unknown error", windows: [] }
		measured.push({ end: window.end, seconds: result.seconds, start: window.start })
	}
	return { windows: measured }
}

function sumSeconds(measured: readonly MeasuredWindow[]): number {
	return measured.reduce((sum, m) => sum + m.seconds, 0)
}

/**
 * Measure a link's overlap and cache it, best effort, when its cache does not already cover the windows.
 *
 * Called when a recording is attached, off the response path. Without it the deduplicated number only appears once something forces a live fetch – which today means the approval itself, so a reviewer would open a submission, read one Hackatime total, and watch a different one get approved underneath them.
 *
 * Failures are swallowed on purpose: every failure mode already degrades to "the overlap could not be checked", which the approval path reports. Throwing would fail a journal entry over a problem that does not affect it.
 */
export async function refreshOverlap(themeProjectId: string, phase: Phase): Promise<void> {
	try {
		const [project, links] = await Promise.all([
			db.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
				.select("theme", "userId")
				.include("user", user => user.select("hackatimeUserId"))
				.first(),
			db.orm.public.HackatimeLink.where({ hoursApproved: null, phase, themeProjectId })
				.select("cachedOverlap", "hackatimeProject", "id")
				.all(),
		])
		const hackatimeUserId = project?.user ? project.user.hackatimeUserId : null
		if (!hackatimeUserId || !project || links.length === 0) return

		const recordings = await makerRecordings(db, project.userId)
		// The week is read once for the phase, however many links it covers.
		const week = phaseWeekWindow(project.theme, phase, project.userId, themeProjectId)
		for (const link of links) await warmLink(link, hackatimeUserId, () => week, recordings)
	} catch {
		// A cache warm that failed is the same as one that never ran.
	}
}

/** One link's identity for warming: enough to ask Hackatime again and to decide whether it needs asking. */
export interface OverlapWarmTarget {
	cachedOverlap?: unknown
	hackatimeProject: string
	id: string
	phase: Phase
	themeProjectId: string
	/** The maker who owns the link, so a recording made under this project but attached elsewhere can be found and measured for. */
	userId: string
}

const key = (projectId: string, phase: Phase) => `${projectId}/${phase}`

/**
 * Warm the overlap cache for a batch of links, for the scheduled sync.
 *
 * The deduplication rests entirely on the cached measurements, and until now only two moments ever wrote them: attaching a recording, and an approval that reads live. Every screen in between – the trail, the project page, the project cards – reads the cache, and finding it cold reports the same sitting twice with nothing on the page to say the check never ran. A participant who recorded while Lapse or Hackatime was briefly unreachable never got a warm cache at all, so their project showed the doubled total until they happened to be approved.
 *
 * Batched, because the sync walks every link every fifteen minutes and cannot afford a query each. The recordings come back in one read per batch rather than one per link, grouped by owner, because a recording attached in one week can be the one a link in another is measured against. A Hackatime request is made only for a link whose cache does not already hold a measurement for each of its windows.
 */
export async function warmLinkOverlap(
	targets: readonly OverlapWarmTarget[],
): Promise<{ warmed: number; failed: number }> {
	if (targets.length === 0) return { failed: 0, warmed: 0 }
	const projectIds = [...new Set(targets.map(t => t.themeProjectId))]
	const userIds = [...new Set(targets.map(t => t.userId))]

	const [recordingsByUser, projects] = await Promise.all([
		recordingsByOwner(db, userIds),
		db.orm.public.ThemeProject.where(project => project.id.in(projectIds))
			.select("id", "theme", "userId")
			.include("user", user => user.select("hackatimeUserId"))
			.all(),
	])
	const projectById = new Map(projects.map(p => [p.id, p] as const))

	// The week each project-phase counts is the same for every link on it, so it is read at most once per batch, and only for a link that needs measuring.
	const weeks = new Map<string, Promise<{ fromSeconds: number; toSeconds: number } | null>>()
	let warmed = 0
	let failed = 0
	for (const target of targets) {
		const project = projectById.get(target.themeProjectId)
		const hackatimeUserId = project?.user?.hackatimeUserId ?? null
		if (!project || !hackatimeUserId) continue
		const k = key(target.themeProjectId, target.phase)
		if (!weeks.has(k)) weeks.set(k, phaseWeekWindow(project.theme, target.phase, project.userId, project.id))
		const outcome = await warmLink(
			{ cachedOverlap: target.cachedOverlap, hackatimeProject: target.hackatimeProject, id: target.id },
			hackatimeUserId,
			() => weeks.get(k) ?? Promise.resolve(null),
			recordingsByUser.get(target.userId) ?? [],
		)
		if (outcome === "warmed") warmed += 1
		if (outcome === "failed") failed += 1
	}
	return { failed, warmed }
}

/**
 * Measure one link's overlap for the recordings that name it, unless its cache already has every window.
 *
 * Shared by the attach path and the sync, so a warmed cache and a refreshed one hold the same thing.
 */
async function warmLink(
	link: { cachedOverlap?: unknown; hackatimeProject: string; id: string },
	hackatimeUserId: string,
	weekOf: () => Promise<{ fromSeconds: number; toSeconds: number } | null>,
	recordings: readonly RecordedWindow[],
): Promise<"warmed" | "cached" | "failed" | "none"> {
	const windows = overlapWindowsFor(recordings, link.hackatimeProject)
	if (windows.length === 0) return "none"
	if (overlapFromCache(windows, parseCachedOverlap(link.cachedOverlap)) !== null) return "cached"

	const measured = await measureOverlap(hackatimeUserId, link.hackatimeProject, windows, await weekOf())
	if (measured.error) {
		// Recorded, never used to decide anything. The next run tries again, and until it succeeds the reading is flagged as unchecked rather than quietly believed.
		await db.orm.public.HackatimeLink.where({ id: link.id })
			.update({ overlapFetchError: measured.error })
			.catch(() => undefined)
		return "failed"
	}
	await db.orm.public.HackatimeLink.where({ id: link.id })
		.update({
			cachedOverlap: { windows: measured.windows },
			overlapFetchError: null,
			overlapFetchedAt: formatDbTimestamp(new Date()),
		})
		.catch(() => undefined)
	return "warmed"
}

/**
 * The summation half of getHoursBreakdown, separated so a caller that has already loaded sessions and links in bulk can apply the SAME rules without issuing three more queries per project.
 *
 * Extracted rather than reimplemented: these rules decide what people are paid, and a second copy that drifts is a second answer to "how many hours is this".
 */
export interface SessionRow {
	hoursApproved: number | null
	hoursClaimed: number
	hoursSource: HoursSource
}

export interface LinkRow {
	/** The Hackatime seconds measured inside each recording window that names this link. See parseCachedOverlap. */
	cachedOverlap?: unknown
	cachedSeconds: number | null
	/** The Hackatime project's name, which is how a recording is paired with this link. */
	hackatimeProject?: string
	hoursApproved: number | null
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
	/**
	 * Every Lapse recording the maker holds under a Hackatime project name (see makerRecordings). A caller that does not pass them gets no deduplication at all, so every caller that shows a total must.
	 */
	recordings: readonly RecordedWindow[] = [],
): {
	journalHours: number
	hackatimeHours: number
	hackatimeOverlapSeconds: number
	/**
	 * True when a link has a recording under its name but its cached measurement does not cover that recording – so the subtraction did not run and the total still carries the overlap. The counterpart of `HoursBreakdown.hackatimeOverlapUnknown`, and for the same reason: a caller that shows this number cannot otherwise tell a deduplicated total from one that quietly was not.
	 */
	hackatimeOverlapUnknown: boolean
	computedTotal: number
	effectiveHours: number
} {
	let journalHours = 0
	for (const s of sessions) {
		// A HACKATIME_TRACKED session still exists as evidence but contributes zero: its time already arrives through the link.
		if (s.hoursSource === HoursSource.HACKATIME_TRACKED) continue
		journalHours += storedHours(s.hoursApproved ?? s.hoursClaimed)
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
		const windows = overlapWindowsFor(recordings, link.hackatimeProject ?? "")
		if (windows.length > 0) {
			const overlap = overlapFromCache(windows, parseCachedOverlap(link.cachedOverlap))
			if (overlap === null) hackatimeOverlapUnknown = true
			else {
				const subtracted = capSubtraction(seconds, overlap)
				hackatimeOverlapSeconds += subtracted
				seconds -= subtracted
			}
		}

		hackatimeHours += seconds / 3600
	}

	const computedTotal = round2(journalHours + hackatimeHours)
	return {
		computedTotal,
		effectiveHours: frozenTotal ?? computedTotal,
		hackatimeHours: round2(hackatimeHours),
		hackatimeOverlapSeconds,
		hackatimeOverlapUnknown,
		journalHours: round2(journalHours),
	}
}

/**
 * Coins a phase minted. Every coin is spendable on anything – the shop, or the printer goal – so there is a single pot and no locked fund.
 *
 * `banked` stays on the shape as a legacy field: rows minted before the pots were merged still carry a banked half, and the review reconcile zeroes that half out (moving it to spendable) the next time an old approval is re-decided. New mints always report it as zero.
 *
 * A type alias rather than an interface on purpose: this gets written into the audit row's JSON payload, and Prisma's `InputJsonValue` only accepts types with an implicit index signature, which interfaces do not have.
 */
// oxlint-disable-next-line typescript/consistent-type-definitions
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
 * [0, fundedHours)   → dollars, not coins. The parts grant; it buys the BOM. [fundedHours, ∞)   → spendable coins, 5 per hour.
 *
 * `fundedHours` is the block the grant actually bought, and the tier's own hours by default. A declined grant buys no parts, so no hours are spoken for and every approved hour pays 5 coins – turning the money down must not also forfeit the work the tier would have funded.
 *
 * The printer on the wall no longer sizes any of this: a tier decides how many hours the project itself eats, and everything past that is simply earned. What a machine asks per week is still paced in ./config/printers.ts, but that pace is guidance the goal tracker reads – warnings, never a second pot of money.
 *
 * Undershooting needs no special case: an approval below the funded line earns nothing and the participant falls behind their own pace, which is exactly what the goal tracker is for.
 *
 * Minted coins are capped, because `approvedHours` can come from a reviewer typing into a box and a fat-fingered 1000 should not mint five thousand coins.
 */
export function designCoinsFor(tierId: number, approvedHours: number, opts: { fundedHours?: number } = {}): CoinSplit {
	const tier = getTierOrThrow(tierId)
	const spendable = earnCoins(Math.max(0, approvedHours - (opts.fundedHours ?? tier.fundingHours)))
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
	// Rounded to millionths before the ceiling: the funded block is subtracted as a float, so 7.4 - 6 arrives as 1.4000000000000004 and times 5 as 7.000000000000002, which would otherwise mint an extra coin.
	const coins = Math.round(hours * COINS_PER_HOUR * 1e6) / 1e6
	return Math.min(Math.ceil(coins), MAX_COINS_PER_PROJECT)
}
