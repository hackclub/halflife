import { COINS_PER_HOUR, printerById, submitFloorFor, weekAsk } from "./config/printers"
import { DESIGN_WEEKS, ONBOARDING_CHECKPOINT_ID, WARMUP_THEME, WARMUP_WEEK_ID } from "./config/program"
import { ENTRY_TIER, getTier } from "./config/tiers"
import { BUILD_HOURS, checkpointsFor, WEEK_META } from "./curriculum"
import { formatDeadline } from "./deadline"
import { round2 } from "./money"
import type { StoreSnapshot } from "./queries/store"
import type { Checkpoint, Experience, Project, SessionLog, Week, WeekMeta } from "./types"

/**
 * The trail, derived from one snapshot of the server's facts and the clock.
 *
 * Everything here is pure: no hooks, no state, no writes. The provider owns the ceremony and the mutations, and calls this once whenever the facts or the clock change. Keeping it apart is what makes the shape of the trail testable without a browser, and what stops the provider's mutation code from being buried in a thousand lines of derivation.
 *
 * The rules are the ones the trail has always had – see `curriculum.checkpointsFor` for how a week is shaped, and the individual callbacks below for why each gate reads what it does.
 */

export interface CheckpointState {
	/** Reel / submit checkpoints record how many artefacts were attached. */
	artefacts: number
	/** When it was completed, epoch ms. Undefined on saves written before this. */
	at?: number
	/** A reel's caption, kept so the project timeline can show what was posted. */
	caption?: string
	done: boolean
	/** Every saved journal session in this checkpoint, newest last. */
	log: SessionLog[]
	/** Journal checkpoints accumulate minutes toward their target. */
	minutes: number
}

export const EMPTY: CheckpointState = { artefacts: 0, done: false, log: [], minutes: 0 }

/** What a checkpoint on a passed week says when it is hovered. */
export const PASSED_REASON = "This week has passed!"

/**
 * Week 1's idea reel is optional: it sits beside the first devlog entry as a choice rather than gating it. The trail still lists it, and it stays postable, but nothing past the fork ever waits on it – so every gate below reads predecessors with this id filtered out.
 */
export const WEEK1_IDEA_REEL_ID = "w1-reel-idea"
const withoutOptionalIdea = (list: Checkpoint[]) => list.filter(c => c.id !== WEEK1_IDEA_REEL_ID)

/**
 * A warm-up project's own week: a chain of entries with one live one waiting, then its single submit, keyed `wu-<project id>-…` because a maker may hold several warm-ups and none of them has a week number. The same tier floors as a season week, since it is handed in the same way.
 */
function warmupWeek(project: Project, build: boolean, isDone: (id: string) => boolean): Week {
	const key = (suffix: string) => `wu-${project.id}-${suffix}`
	const tier = getTier(project.tier) ?? ENTRY_TIER
	const submitHours = build ? BUILD_HOURS : submitFloorFor(tier.fundingHours)
	const meta: WeekMeta = {
		accent: "var(--color-violet-pale)",
		accentDeep: "var(--color-violet-deep)",
		examples: [],
		fullName: "Warm-up project",
		headline: "WARM UP",
		id: WARMUP_WEEK_ID,
		phase: build ? "build" : "design",
		primer: "",
		summary: "Any hardware project, before week 1 opens.",
		theme: WARMUP_THEME.label,
	}
	let written = 0
	while (isDone(key(`entry-${written + 1}`))) written += 1
	const entries: Checkpoint[] = Array.from({ length: written + 1 }, (_, i) => ({
		blurb: "Journal your progress with pictures and screenshots!",
		entryTarget: 1,
		id: key(`entry-${i + 1}`),
		kind: "journal",
		title: `Entry ${i + 1}`,
		weekId: WARMUP_WEEK_ID,
	}))
	return {
		...meta,
		checkpoints: [
			...entries,
			{
				blurb: "Submit your warm-up project.",
				id: key("submit"),
				kind: "submit",
				title: build ? "Submit your build" : "Submit your design",
				weekId: WARMUP_WEEK_ID,
			},
		],
		earnFrom: build ? 0 : tier.fundingHours,
		fundingHours: build ? BUILD_HOURS : tier.fundingHours,
		projectId: project.id,
		submitHours,
		targetHours: submitHours,
		tier: tier.id,
	}
}

/** Recommended tier from the onboarding experience answer. */
export function recommendedTier(e: Experience | null): 1 | 2 | 3 {
	if (e === "lots") return 3
	if (e === "some") return 2
	return 1
}

export interface Trail {
	allCheckpoints: Checkpoint[]
	currentCheckpointId: string | null
	deadlineOf(week: Week): string | null
	hoursOf(week: Week): number
	isHeld(id: string): boolean
	isPassed(id: string): boolean
	isUnlocked(id: string): boolean
	lockReason(id: string): string | null
	overlapUnchecked(weekId: number): boolean
	passedOf(week: Week): boolean
	pendingCoins(weekId: number): number
	phaseStatusOf(weekId: number): string
	reelHours(weekId: number): number
	stateOf(id: string): CheckpointState
	statusOf(week: Week): string
	totalHours: number
	warmupDeadline: string
	warmupWeekOf(projectId: string): Week | null
	weekClosesAtMs(weekId: number): number | null
	weekDeadline(weekId: number): string | null
	weekExtension(weekId: number): "account" | "project" | null
	weekHours(weekId: number): number
	weekOf(weekId: number): Week
	weekOfCheckpoint(checkpoint: Checkpoint): Week
	weekOpensOn(weekId: number): string | null
	weekPassed(weekId: number): boolean
	weekStarted(weekId: number): boolean
	weekSubmitted(weekId: number): boolean
	weeks: Week[]
}

export function deriveTrail(save: StoreSnapshot, now: number): Trail {
	const weekPassed = (weekId: number) => {
		const closesAt = save.weekClosesAt[weekId]
		return closesAt !== undefined && now >= closesAt
	}

	const weekStarted = (weekId: number) => {
		const opensAt = save.weekOpensAt[weekId]
		return opensAt === undefined || now >= opensAt
	}

	const dayLabel = (at: number) =>
		new Date(at).toLocaleDateString("en-US", {
			day: "numeric",
			month: "long",
			timeZone: save.programTimezone,
			weekday: "long",
		})
	const weekOpensOn = (weekId: number) => {
		const at = save.weekOpensAt[weekId]
		return at === undefined ? null : dayLabel(at)
	}
	const weekDeadline = (weekId: number) => {
		const at = save.weekClosesAt[weekId]
		return at === undefined ? null : formatDeadline(at, save.programTimezone)
	}
	const weekClosesAtMs = (weekId: number) => save.weekClosesAt[weekId] ?? null
	const weekExtension = (weekId: number) => save.weekExtensions[weekId] ?? null
	const warmupDeadline = formatDeadline(save.warmupsCloseAt, save.programTimezone)

	/** Where a week stands with review: draft, in_review, update_requested, approved or rejected. */
	const phaseStatusOf = (weekId: number) => save.phaseStatusByWeek[weekId] ?? "draft"

	// Handed in – in review, or decided. A week sent back for changes is open again, because fixing it is the point of sending it back.
	const weekSubmitted = (weekId: number) => {
		const status = save.phaseStatusByWeek[weekId]
		return status === "in_review" || status === "approved" || status === "rejected"
	}

	// Saves written before a field existed would otherwise hand back a record with holes in it, so every read is filled out from EMPTY.
	const stateOf = (id: string): CheckpointState => ({ ...EMPTY, ...save.progress[id] })

	// A build week inherits the tier of the design week it is building. A week nobody has started yet borrows the last tier picked, so the trail shows a believable shape instead of lurching when the project is finally created.
	const tierForWeek = (weekId: number): 1 | 2 | 3 => {
		const designWeek = weekId > DESIGN_WEEKS ? weekId - DESIGN_WEEKS : weekId
		const own = save.projects.find(p => p.weekId === designWeek)
		if (own) return own.tier
		return save.projects.at(-1)?.tier ?? recommendedTier(save.experience)
	}

	// The printer you are saving for sets how many hours a week you need to earn, and that number is the same on every tier – the tier only decides how many funded hours sit underneath it.
	const goal = printerById(save.goalId)

	/**
	 * The minutes behind each written devlog in a week, with the time that did not arrive through one – Hackatime, a reviewer's adjustment – folded onto the last of them.
	 *
	 * That is where it belongs: it is the work done since that devlog, so the entry the next progress reel answers to is the one it landed on. Folded rather than added at the week level because tracked hours on their own, before anything has been written up, are not a reel anyone has something to show – so a week with no entry yet still runs on entries alone.
	 *
	 * One array, read both by the placement of the reels (`checkpointsFor` walks it) and by the gate that unlocks them, because a trail that places a reel on one entry and opens it on another is a trail that has said two things at once.
	 */
	const writtenMinutes = (weekId: number): number[] => {
		const written: number[] = []
		for (;;) {
			const entry = save.progress[`w${weekId}-entry-${written.length + 1}`]
			if (!entry?.done) break
			written.push(entry.minutes)
		}
		const offBook = save.offBookHours[weekId] ?? 0
		// Only onto a devlog that exists: a week with nothing written keeps its reel clock on entries alone.
		const last = written.length - 1
		if (last >= 0 && offBook > 0) written[last] = (written[last] ?? 0) + offBook * 60
		return written
	}

	const weeks: Week[] = WEEK_META.map(meta => {
		const tierId = tierForWeek(meta.id)
		const tier = getTier(tierId) ?? ENTRY_TIER
		const build = meta.phase === "build"
		// Column 5 is the tier-1 week and is already floored to a flat 10 hours, so every other tier is that plus the extra hours its grant funds.
		const target = build ? BUILD_HOURS : weekAsk(goal.hoursPerWeek, tier.fundingHours)
		// The same ask at the cheapest machine's pace: the least a week can be worth and still leave a printer at the end of the season.
		const submitHours = build ? BUILD_HOURS : submitFloorFor(tier.fundingHours)
		return Object.assign({}, meta, {
			checkpoints: checkpointsFor(
				meta,
				// The trail is as long as the work was: every finished entry is a node, and one more waits at the end for the entry about to be written. The minutes come along because reels are placed where the clock crossed.
				writtenMinutes(meta.id),
				cid => save.progress[cid]?.done ?? false,
				submitHours,
				// Onboarding made week one's project and it has since been deleted: `projects` only lists live, named ones.
				meta.id === 1
					&& (save.progress[ONBOARDING_CHECKPOINT_ID]?.done ?? false)
					&& !save.projects.some(p => p.weekId === 1),
			),
			// Build-week hours all bank; the grant paid for the design week.
			earnFrom: build ? 0 : tier.fundingHours,
			fundingHours: build ? BUILD_HOURS : tier.fundingHours,
			submitHours,
			targetHours: target,
			tier: tierId,
		})
	})

	// Each warm-up, as a week of its own that the trail never draws.
	const warmupWeeks: Week[] = save.projects.flatMap(project => {
		const info = save.warmups[project.id]
		if (project.weekId !== WARMUP_WEEK_ID || !info) return []
		return [warmupWeek(project, info.phase === "build", id => save.progress[id]?.done ?? false)]
	})

	// Every checkpoint a modal can open, the warm-ups' included. The trail itself draws `weeks` only.
	const allCheckpoints = [...weeks, ...warmupWeeks].flatMap(w => w.checkpoints)

	const warmupWeekOf = (projectId: string) => warmupWeeks.find(w => w.projectId === projectId) ?? null

	const weekOf = (weekId: number): Week => {
		const week = weeks.find(w => w.id === weekId) ?? weeks[0]
		// The curriculum is a compile-time constant with ten weeks in it, so an empty list is a broken build rather than a state to render around.
		if (!week) throw new Error("The curriculum has no weeks in it")
		return week
	}

	/**
	 * What a week is worth, for the gates that ask what it is worth rather than what its devlogs carry: Submit's floor and the pace math.
	 *
	 * Journalled entries plus whatever arrived another way – Hackatime link time, and any hours a reviewer adjusted – and unlike `reelHours` below it counts the off-book half even in a week with nothing written, because Submit and the coins are owed for the work rather than for the write-up of it.
	 */
	const weekHours = (weekId: number) => {
		const week = weeks.find(w => w.id === weekId)
		if (!week) return 0
		const mins = week.checkpoints.reduce((n, c) => n + (save.progress[c.id]?.minutes ?? 0), 0)
		return mins / 60 + (save.offBookHours[weekId] ?? 0)
	}

	const overlapUnchecked = (weekId: number) => save.overlapUncheckedWeeks.includes(weekId)

	/**
	 * Hours on the reel clock: what the written devlogs carry, the last of them including the time tracked since it was written.
	 *
	 * The very same array the reels are placed on, so a reel cannot be placed after one entry and opened by another. `weekHours` is the same figure for any week that has been written up, and differs only in the case it must: a week with nothing written yet, where tracked hours count towards Submit and towards the coins but no reel is due, because there is no devlog for it to answer to.
	 */
	const reelHours = (weekId: number) => writtenMinutes(weekId).reduce((n, m) => n + m, 0) / 60

	// The same questions asked of a week object, so a sheet can serve a warm-up (which has no week number of its own) as readily as a season week.
	const weekOfCheckpoint = (checkpoint: Checkpoint): Week =>
		warmupWeeks.find(w => w.checkpoints.some(c => c.id === checkpoint.id)) ?? weekOf(checkpoint.weekId)
	const hoursOf = (week: Week): number => {
		if (!week.projectId) return weekHours(week.id)
		const mins = week.checkpoints.reduce((n, c) => n + (save.progress[c.id]?.minutes ?? 0), 0)
		return mins / 60 + (save.warmups[week.projectId]?.offBookHours ?? 0)
	}
	/**
	 * Everything logged, as one number: every season week's hours plus every warm-up's. A warm-up has no week of its own, so it is found by project and read through `hoursOf`; the season weeks go through `weekHours`. Both already fold in the time that did not come from an entry (Hackatime, a reviewer's adjustment), which is what makes this "journalled and tracked" rather than entries alone.
	 */
	const totalHours =
		weeks.reduce((n, w) => n + weekHours(w.id), 0)
		+ save.projects.reduce((n, p) => {
			const week = p.weekId === WARMUP_WEEK_ID ? warmupWeekOf(p.id) : null
			return week ? n + hoursOf(week) : n
		}, 0)
	const passedOf = (week: Week): boolean => {
		if (!week.projectId) return weekPassed(week.id)
		const closesAt = save.warmups[week.projectId]?.closesAt
		return closesAt !== undefined && now >= closesAt
	}
	const deadlineOf = (week: Week): string | null => {
		if (!week.projectId) return weekDeadline(week.id)
		const closesAt = save.warmups[week.projectId]?.closesAt
		return closesAt === undefined ? null : formatDeadline(closesAt, save.programTimezone)
	}
	const statusOf = (week: Week): string => {
		if (!week.projectId) return phaseStatusOf(week.id)
		const project = save.projects.find(p => p.id === week.projectId)
		return (week.phase === "build" ? project?.buildStatus : project?.designStatus) ?? "draft"
	}

	/**
	 * What the unreviewed weeks are on course to earn, at the ledger's own rule: every hour past the week's funded block (all of a build week's) at COINS_PER_HOUR. Approved weeks are skipped because their coins are already minted, rejected ones because they will never mint. It is a projection – a reviewer can still adjust the hours – which is why it only feeds the pace warning and never the balance anyone can spend.
	 */
	const pendingCoins = (weekId: number) =>
		weeks
			.filter(w => w.id <= weekId)
			.reduce((n, w) => {
				const status = save.phaseStatusByWeek[w.id]
				if (status === "approved" || status === "rejected") return n
				return n + Math.max(0, weekHours(w.id) - w.earnFrom) * COINS_PER_HOUR
			}, 0)

	/**
	 * Whether a checkpoint is shut because its week ran out of time.
	 *
	 * Every node on a passed week is, done or not, with two exceptions: the Submit that still owes the week's hand-in, and a setup nobody has done yet – a late joiner still has to come in through the front door. A Submit with nothing logged behind it passes with the rest, because the server refuses an empty hand-in and there is nothing left to do about that.
	 */
	const isPassed = (id: string): boolean => {
		const week = [...weeks, ...warmupWeeks].find(w => w.checkpoints.some(c => c.id === id))
		const self = week?.checkpoints.find(c => c.id === id)
		if (!week || !self || !passedOf(week)) return false
		const done = save.progress[id]?.done ?? false
		if (self.kind === "onboarding" && !done) return false
		if (self.kind === "submit" && !done && hoursOf(week) > 0) return false
		return true
	}

	/**
	 * Whether a checkpoint waits on a deleted reel.
	 *
	 * Deleting the last reel on a checkpoint reopens it, and until it is posted again every other checkpoint is held – done ones included, so the map shows plainly that one thing is owed. The server holds the same line (lib/reel-gate), and only ever reports a reel owed while its week can still take one, so the hold always has a way out.
	 */
	const isHeld = (id: string): boolean => save.owedReels.length > 0 && !save.owedReels.includes(id)

	/**
	 * Weeks do not hold each other. A week opens on its Monday whatever the week before it did, so a maker who never handed one in can still start the next – the clock is the only thing that orders them.
	 *
	 * It used to be otherwise: an unhanded-in week kept the next shut until it was submitted. That dead-ended anyone who could not reach that week's floor – the tier is the maker's own choice, and a week below its floor cannot be handed in at all – and it also punished asking for an extension, which is granted precisely when a maker is behind. Nothing is lost by not waiting: a passed week's Submit stays open for anyone who does reach the floor, so late work can still go in.
	 *
	 * What does still break the sequence:
	 *
	 * - a week that has passed is shut, all but the Submit it still owes – which opens whatever the hours say, since no more can be logged;
	 *
	 * - anything on the clock (the milestone reels, and Submit itself) opens on the week's hours, so a half-written entry never traps you and the choice to wrap up is always live. Everything else unlocks in order, as it always has – except week 1's idea reel, which is the optional arm of the opening fork and never holds anything shut (see WEEK1_IDEA_REEL_ID).
	 */
	const isUnlocked = (id: string): boolean => {
		// The owed reel is the way out, so it opens whatever else is true – including a week that has since closed while this tab held a stale snapshot. Checking `isPassed` first dead-mapped the whole trail until the page was reloaded and the server stopped reporting the debt.
		if (save.owedReels.includes(id)) return true
		if (isPassed(id)) return false
		if (isHeld(id)) return false
		const done = (c: Checkpoint) => save.progress[c.id]?.done ?? false
		const wi = weeks.findIndex(w => w.checkpoints.some(c => c.id === id))
		if (wi === -1) return false
		// Nothing on a week opens before its Monday, Get started included.
		const opening = weeks[wi]
		if (opening && !weekStarted(opening.id)) return false

		const week = weeks[wi]
		const list = week?.checkpoints ?? []
		const i = list.findIndex(c => c.id === id)
		const self = list[i]
		if (!week || !self) return false

		if (self.kind === "submit" && weekPassed(week.id)) return true

		if (self.atHours !== undefined) {
			// A progress reel is earned by the hours the devlogs carry, tracked time included once the week has been written up (see `reelHours`); Submit and "Keep working" read what the week is worth in total. Only progress reels carry atHours besides those two, so `kind` is the whole distinction.
			const hours = self.kind === "reel" ? reelHours(week.id) : weekHours(week.id)
			// Unwritten entries never block a milestone – the clock does. Neither does a milestone that is not due yet: the reel waiting at 30h cannot hold up a Submit that opened at 23.76h.
			//
			// "Keep working" rides this rule too, at atHours 0. A reel that has come due is the cadence asking to be paid before the week runs on; letting the fork's other arm open around it would make every progress reel skippable forever.
			//
			// Week 1's idea reel is the exception: it is the optional arm of the opening fork, so it never holds the clock's milestones or Submit shut, whichever arm the maker took.
			const gates = withoutOptionalIdea(list.slice(0, i)).filter(c => c.kind !== "journal" && (c.atHours ?? 0) <= hours)
			return gates.every(done) && hours >= self.atHours
		}

		return withoutOptionalIdea(list.slice(0, i)).every(done)
	}

	/**
	 * Why a checkpoint is shut, in the maker's terms. Null when it is open.
	 *
	 * It walks the same rules as isUnlocked, in the same order, and lives next to it so the two cannot drift: a trail that says one thing and does another is worse than a trail that says nothing. Each branch names the one thing standing in the way rather than listing everything outstanding – only the first is actionable anyway.
	 */
	const lockReason = (id: string): string | null => {
		// Titles are node names, so they keep their capital. The verb follows the kind: you post a reel, you finish everything else.
		const firstFinish = (c: Checkpoint) => (c.kind === "reel" ? `Post ${c.title} first.` : `Finish ${c.title} first.`)

		if (isUnlocked(id)) return null
		if (isPassed(id)) return PASSED_REASON
		if (isHeld(id)) {
			const [owedId] = save.owedReels
			const owed = weeks.flatMap(w => w.checkpoints).find(c => c.id === owedId)
			return owed ? `Re-record ${owed.title} first. You deleted it.` : "Re-record the reel you deleted first."
		}

		const done = (c: Checkpoint) => save.progress[c.id]?.done ?? false
		const wi = weeks.findIndex(w => w.checkpoints.some(c => c.id === id))
		if (wi === -1) return null

		const opening = weeks[wi]
		if (opening && !weekStarted(opening.id)) {
			const day = weekOpensOn(opening.id)
			return day ? `Week ${opening.id} opens ${day}.` : `Week ${opening.id} has not opened yet.`
		}

		const week = weeks[wi]
		const list = week?.checkpoints ?? []
		const i = list.findIndex(c => c.id === id)
		const self = list[i]
		if (!week || !self) return null

		if (self.atHours !== undefined) {
			const hours = self.kind === "reel" ? reelHours(week.id) : weekHours(week.id)
			const owed = withoutOptionalIdea(list.slice(0, i)).find(
				c => c.kind !== "journal" && (c.atHours ?? 0) <= hours && !done(c),
			)
			if (owed) return firstFinish(owed)
			const toGo = round2(self.atHours - hours)
			return `Opens at ${self.atHours}h logged this week (${toGo}h to go).`
		}

		const blocker = withoutOptionalIdea(list.slice(0, i)).find(c => !done(c))
		return blocker ? firstFinish(blocker) : null
	}

	// Once the first devlog is written the opening fork is settled on the skip arm, so the unposted idea reel stops being the trail's answer to "where next" – it stays open as an extra, not as the current.
	const skipSettled = save.progress["w1-entry-1"]?.done ?? false
	const currentCheckpointId =
		allCheckpoints.find(
			c => !(save.progress[c.id]?.done ?? false) && isUnlocked(c.id) && !(skipSettled && c.id === WEEK1_IDEA_REEL_ID),
		)?.id ?? null

	return {
		allCheckpoints,
		currentCheckpointId,
		deadlineOf,
		hoursOf,
		isHeld,
		isPassed,
		isUnlocked,
		lockReason,
		overlapUnchecked,
		passedOf,
		pendingCoins,
		phaseStatusOf,
		reelHours,
		stateOf,
		statusOf,
		totalHours,
		warmupDeadline,
		warmupWeekOf,
		weekClosesAtMs,
		weekDeadline,
		weekExtension,
		weekHours,
		weekOf,
		weekOfCheckpoint,
		weekOpensOn,
		weekPassed,
		weekStarted,
		weekSubmitted,
		weeks,
	}
}
