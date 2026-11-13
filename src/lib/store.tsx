"use client"

import { useRouter } from "next/navigation"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { errorMessage } from "@/lib/api-error"
import { ParticipantGoal } from "@/lib/enums"
import { COINS_PER_HOUR, type PrinterGoal, printerById } from "./config/printers"
import type { StoreSnapshot } from "./queries/store"
import { type IntroPhase, useStoreCeremony } from "./store-ceremony"
import { useProjectWrites } from "./store-project-writes"
import { type SubmitExtras, type UnsubmitTarget, useStoreWrites } from "./store-writes"
import { type CheckpointState, deriveTrail } from "./trail"
import type { Checkpoint, Experience, Project, SessionLog, Week } from "./types"

/**
 * The trail's store, backed by the database.
 *
 * ## The split
 *
 * Facts come from the server, as a `StoreSnapshot` loaded once per navigation by the `(app)` layout: projects, checkpoint states, coins, streak, goal. Ceremony stays in `localStorage`: whether the cinematic has played, how far the tab tour got, whether the Doomscroller rail is open. Nobody else ever needs to read the ceremony, and a new laptop replaying the intro is a feature rather than a bug.
 *
 * ## Why the derivation did not change
 *
 * Everything below `weeks` – the shape of a week, which node is live, what is locked and why – is computed exactly as it was when the data was a toy, by `curriculum.checkpointsFor`. The server says which checkpoints are done and with what; it does not say what a week looks like. A second checkpoint engine on the server would have been a second answer to "have I finished this week", and the first time the two disagreed the trail would have lied to someone about work they had really done.
 *
 * ## Writes
 *
 * Every mutation posts to the API and then asks Next to re-render the layout, which reloads the snapshot. Each one also patches local state first, because a round trip to Postgres between clicking a node and seeing it fill is long enough to feel broken – and if the request fails the refresh puts the truth back.
 */

/** The details a maker can change on their own project, all optional. */
export interface ProjectPatch {
	coverImageKey?: string | null
	description?: string
	githubRepo?: string | null
	name?: string
	/** Which starter it is built from, or null for their own idea. */
	starterProjectId?: string | null
	tier?: 1 | 2 | 3
}

/**
 * The closing reel's share prompt after a hand-in: what to celebrate, and how. Kept in the store rather than in the submit sheet's own state because the hand-in's refresh flips the week to in_review underneath – a local flag renders the celebration for one frame and then the unsubmit sheet takes the modal.
 */
export interface SharePost {
	celebration?: { extraHours: number }
	checkpointId: string
	eyebrow: string
	postId: string
	videoUrl: string | null
}

/** What posting a reel produced: the post's id, or the sentence to show the maker. */
export type PostReelResult = { postId: string; error?: undefined } | { postId?: undefined; error: string }

interface Ctx {
	addProject(p: Omit<Project, "id">): void
	allCheckpoints: Checkpoint[]
	/** Legacy locked coins. Drains to zero; kept so old rows still add up. */
	bankedCoins: number
	/**
	 * Admins only: open one locked checkpoint, leaving the rest of the trail locked. Lasts until the page is reloaded. Does nothing for anyone else.
	 */
	bypassCheckpoint(id: string): void
	/**
	 * Admins only: every checkpoint on the trail opens, whatever its order, hours or dates say. Always false for anyone else.
	 */
	bypassLocks: boolean
	/** Spendable coins – what the shop will take for anything. */
	coins: number
	complete(id: string, patch?: Partial<CheckpointState>): void
	currentCheckpointId: string | null
	/** When a week stops taking entries, a warm-up's included. */
	deadlineOf(week: Week): string | null
	doomscrollerOpen: boolean
	/**
	 * Correct a finished entry's words, hours, and timelapses. Null once saved, or why it was refused. The clips are the full desired set of Lapse attachments; the server keeps, adds, and releases the difference.
	 */
	editSession(
		id: string,
		minutes: number,
		body: string,
		evidence?: Pick<SessionLog, "clips">,
		workedOn?: string,
	): Promise<string | null>
	/**
	 * Make the project row for a design week, if there is none yet, and resolve to its id (null if the server refused). Called when a "create a project" checkpoint is opened, which is the only moment a project row is made.
	 */
	ensureProject(weekId: number): Promise<string | null>
	experience: Experience | null
	/**
	 * Mark the first checkpoint done, on the API's say-so. Patched rather than awaited so the goal prompt can take over from the onboarding modal without a frame of the tab tour in between.
	 */
	finishOnboarding(): void
	/** End the tab tour, finished or skipped, and remember it was seen. */
	finishTour(): void
	/** The printer your earnings are paced against. See config/printers. */
	goalId: string
	/** What a week is worth, a warm-up's included. See `weekHours`. */
	hoursOf(week: Week): number
	hydrated: boolean
	/** Whether a checkpoint is held until a deleted reel is re-recorded. */
	isHeld(id: string): boolean
	/** Whether a checkpoint is shut because its week's time ran out. */
	isPassed(id: string): boolean
	isUnlocked(id: string): boolean
	/** The days a journal entry may be dated to right now. See `journalWindow` in lib/program. */
	journalWindow: StoreSnapshot["journalWindow"]
	/**
	 * Point a project's repo link at the repo its sync writes to, when the two drifted apart because the sync's repo was picked after the project's was set. Resolves to null once saved, or the server's reason for refusing; the link is the sync target already, so no URL is taken from the client.
	 */
	linkSyncRepoToProject(id: string): Promise<string | null>
	/** Why a locked checkpoint is locked, phrased for the trail. Null if open. */
	lockReason(id: string): string | null
	/**
	 * Resolves to null once the entry is saved, or to the server's reason for refusing it – Lapse may say a timelapse is not yours, is still processing, or already backs another entry, and the sheet has to stay open to say so.
	 */
	logSession(
		id: string,
		minutes: number,
		body: string,
		evidence?: Pick<SessionLog, "clips">,
		workedOn?: string,
	): Promise<string | null>
	/** Self-reported hours already logged, by the day they were worked. See the snapshot. */
	manualHoursByDay: StoreSnapshot["manualHoursByDay"]
	/** Whether the first checkpoint has been completed. */
	onboardingDone: boolean
	/** id of the checkpoint whose modal is open, if any */
	openCheckpoint: string | null
	/**
	 * Whether this week's hours may still count one sitting twice, because the overlap between a Lapse recording and Hackatime could not be checked.
	 *
	 * True means the number is unchecked, not wrong: the deduplication needs a Hackatime answer and there was not one. Anything showing a week total reads this so it can say which totals are provisional.
	 */
	overlapUnchecked(weekId: number): boolean
	/**
	 * What this participant is here for, or null if they have not been asked yet. See config/goal.
	 *
	 * Null is a gate, not a default: it is what keeps the mandatory prompt open after the first checkpoint, and because it comes from the server it reappears on every sign-in rather than on every visit to this browser.
	 */
	participantGoal: ParticipantGoal | null
	/** Whether a week's journal has closed, a warm-up's included. */
	passedOf(week: Week): boolean
	/**
	 * Coins the logged hours of weeks 1..weekId will earn once reviewed, that are not in `printerFund` yet. Coins are minted at approval, so the fund alone says a week nobody has reviewed earned nothing; pacing reads both.
	 */
	pendingCoins(weekId: number): number
	phase: IntroPhase
	/** Where a week stands with review. "draft" when nothing is recorded. */
	phaseStatusOf(weekId: number): string
	/**
	 * Post the reel a checkpoint is asking for. The video is already uploaded.
	 *
	 * Resolves to the new post's id, or to the reason it did not land. The reason is the server's own rather than a guess: a maker held up by an owed reel, or by an upload the server will not accept, used to be told their connection had failed, with no way to work out why.
	 */
	postReel(id: string, caption: string, objectKey: string): Promise<PostReelResult>
	/**
	 * Admins only: week 5's participant copy as it reads from midnight on its first day, when Breadboard Computer becomes Freestyle, shown now. Only what this browser renders changes; pages the server writes out switch at midnight itself. Always false for anyone else.
	 */
	previewFreestyle: boolean
	/** The whole balance. Every coin counts toward the printer goal. */
	printerFund: number
	progress: { [_: string]: CheckpointState }
	projects: Project[]
	/**
	 * Admins only: wipe your own setup answers and run the whole first run again, setup checkpoint included. Resolves to an error message, or null.
	 */
	redoOnboarding(): Promise<string | null>
	reducedMotion: boolean
	reset(): void
	setBypassLocks(on: boolean): void
	setDoomscroller(open: boolean): void
	setOpenCheckpoint(id: string | null): void
	/**
	 * Record what this participant is here for, with the printer if the answer is a printer. Resolves to null once saved, or to the server's reason for refusing – the prompt that calls it is uncloseable, so a silent failure would strand somebody.
	 */
	setParticipantGoal(goal: ParticipantGoal, printerGoalId?: string): Promise<string | null>

	setPhase(p: IntroPhase): void
	setPreviewFreestyle(on: boolean): void
	/**
	 * Set or clear a project's repo link. Resolves to null once saved, or to the server's reason for refusing (a phase in review, say), so an inline editor can say so instead of quietly reverting.
	 */
	setProjectRepo(id: string, url: string | null): Promise<string | null>
	/**
	 * Save the tier the maker is asking for. Resolves to null once saved, or to the server's reason for refusing.
	 *
	 * The submit sheet awaits this before handing the phase in: the server prices the parts list and gates the hours against the stored request, so a hand-in sent before the request lands is read at the previous tier.
	 */
	setProjectTier(id: string, tier: 1 | 2 | 3): Promise<string | null>
	/** Show the share prompt after a hand-in, or clear it. */
	setSharePost(share: SharePost | null): void
	setTourStep(n: number): void
	/** The share prompt waiting after a hand-in, if any. Cleared when it closes. */
	sharePost: SharePost | null
	stateOf(id: string): CheckpointState
	/** Where a week stands with review, a warm-up's included. */
	statusOf(week: Week): string
	streak: number
	/** Hand a week in, with its notes and whatever evidence it collected. */
	/** Resolves to null once submitted, or the server's reason for refusing. */
	submitPhase(id: string, extra?: SubmitExtras): Promise<string | null>
	/**
	 * Every hour on the record – journalled in entries and tracked some other way (Hackatime, a reviewer's adjustment) – summed across the season's weeks and every warm-up. Zero until the first session lands.
	 */
	totalHours: number
	tourStep: number
	/**
	 * Take a phase in review back out of it. Null once done, or the server's reason. A trail submit passes its checkpoint id; a project with no checkpoint to address it by (a warm-up project) passes itself directly.
	 */
	unsubmitPhase(target: UnsubmitTarget): Promise<string | null>
	/** Change any of a project's own details in one save. Null once saved, or why it was refused. */
	updateProject(id: string, patch: ProjectPatch): Promise<string | null>
	/** Who is signed in. Display fields only. */
	viewer: StoreSnapshot["viewer"]
	/** When warm-ups stop taking work: 11:59 PM the night before week 1 opens. */
	warmupDeadline: string
	/**
	 * A warm-up project's own week, or null. Never drawn on the trail, but its entries and its one submit are real checkpoints (`wu-<id>-…`), so the season's journal and submit sheets serve it from its project page. A maker may hold several, which is why these are found by project, not number.
	 */
	warmupWeekOf(projectId: string): Week | null
	/**
	 * The same close as a moment rather than a phrase, epoch ms, its extension included. `weekDeadline` is for writing it down; a countdown has to count to it, and there is no arithmetic to do on a formatted date.
	 */
	weekClosesAtMs(weekId: number): number | null
	/** When a week stops taking work, e.g. "Sunday, October 5 at 11:59 PM", its extension included. */
	weekDeadline(weekId: number): string | null
	/**
	 * Whose extension a week's countdown is racing, when it is racing one: `"project"` for the week's own project's, `"week"` for one granted to the week itself, `"account"` for the participant's own – which covers every week at once – or null when the week closes on its own.
	 */
	weekExtension(weekId: number): "account" | "project" | "week" | null
	/** Hours logged across every session checkpoint in a week. */
	weekHours(weekId: number): number
	weekOf(weekId: number): Week
	/** The week a checkpoint belongs to: a season week, or a warm-up's own. */
	weekOfCheckpoint(checkpoint: Checkpoint): Week
	/** The day a week opens, e.g. "Monday, October 5", in the program's timezone. */
	weekOpensOn(weekId: number): string | null
	/** Whether a week's 11:59 PM Sunday close (or its extension) is behind us. */
	weekPassed(weekId: number): boolean
	/** Whether a week's Monday-midnight open is behind us. Nothing on it opens before. */
	weekStarted(weekId: number): boolean
	/** Whether a week is handed in – in review, approved or rejected – so its entries are final. */
	weekSubmitted(weekId: number): boolean
	/** The trail, cut to the tier of each week's project. */
	weeks: Week[]
}

const StoreContext = createContext<Ctx | null>(null)

export function StoreProvider({ snapshot, children }: { snapshot: StoreSnapshot; children: ReactNode }) {
	const router = useRouter()

	// Server state as the starting point, patched locally while a write is in flight. Re-seeded from props during render rather than in an effect: an effect would paint one frame of stale data every time a refresh lands.
	const [facts, setFacts] = useState<StoreSnapshot>(snapshot)
	const [seen, setSeen] = useState<StoreSnapshot>(snapshot)
	// The clock the week locks read. Seeded from the server's, so the first paint matches the server render, and moved on only when a week closes.
	const [now, setNow] = useState(snapshot.now)
	if (seen !== snapshot) {
		setSeen(snapshot)
		setFacts(snapshot)
		setNow(snapshot.now)
	}

	// A trail left open over midnight greys a closing week out, and opens a starting one, on the stroke of it rather than on the next navigation. Timers top out at about 24.8 days, so a moment further off than that just re-arms when this one fires.
	useEffect(() => {
		const [next] = [
			...Object.values(facts.weekClosesAt),
			...Object.values(facts.weekOpensAt),
			...Object.values(facts.warmups).map(w => w.closesAt),
		]
			.filter(at => at > now)
			.toSorted((a, b) => a - b)
		if (next === undefined) return
		const t = window.setTimeout(() => setNow(Date.now()), Math.min(next - now, 2 ** 31 - 1))
		return () => window.clearTimeout(t)
	}, [facts.weekClosesAt, facts.weekOpensAt, facts.warmups, now])

	const trail = useMemo(() => deriveTrail(facts, now), [facts, now])
	const {
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
	} = trail

	const [openCheckpoint, setOpenCheckpoint] = useState<string | null>(null)
	const [sharePost, setSharePost] = useState<SharePost | null>(null)
	const [tourStep, setTourStep] = useState(0)
	const refreshWeeks = useCallback(() => setNow(Date.now()), [])
	const ceremony = useStoreCeremony({
		isAdmin: facts.viewer.isAdmin,
		onboardingDone: facts.onboardingDone,
		onFreestylePreviewChange: refreshWeeks,
		weekOneStarted: weekStarted(1),
	})
	const {
		bypassCheckpoint,
		bypassLocks,
		finishTour,
		hydrated,
		isBypassed,
		phase,
		previewFreestyle,
		reducedMotion,
		resetCeremony,
		reseedCeremony,
		setBypassLocks,
		setDoomscroller,
		setPhase,
		setPreviewFreestyle,
	} = ceremony

	/**
	 * Replay the first run.
	 *
	 * Ceremony only. It cannot un-log a session or un-post a reel, and pretending otherwise would be the more surprising behaviour: the trail comes back exactly as it was, with the intro playing over it.
	 */
	const reset = useCallback(() => {
		resetCeremony()
		setTourStep(0)
		setOpenCheckpoint(null)
	}, [resetCeremony])

	/**
	 * The full redo, for admins checking the flow. The server clears the answers first; only then is the ceremony reseeded, and without `replaying`, so once the refreshed snapshot says onboarding is not done the intro runs on into the setup checkpoint as it would for someone new.
	 */
	const redoOnboarding = useCallback(async (): Promise<string | null> => {
		let res: Response
		try {
			res = await fetch("/api/onboarding/reset", { method: "POST" })
		} catch {
			return "Could not reach the server. Nothing was reset, so try again."
		}
		if (!res.ok) {
			const payload: unknown = await res.json().catch(() => null)
			return errorMessage(payload, `Could not reset onboarding (${res.status})`)
		}
		setFacts(f => ({ ...f, onboardingDone: false }))
		reseedCeremony()
		setTourStep(0)
		setOpenCheckpoint(null)
		router.refresh()
		return null
	}, [reseedCeremony, router])

	// What the trail lets you click. An admin bypassing the locks, all of them or one node, can open anything; the server still has the last word on whatever is saved from a node opened that way. "Start here" keeps to the real rules above.
	const isOpen = useCallback(
		(id: string) => bypassLocks || isBypassed(id) || isUnlocked(id),
		[bypassLocks, isBypassed, isUnlocked],
	)

	const { addProject, ensureProject, linkSyncRepoToProject, setProjectRepo, setProjectTier, updateProject } =
		useProjectWrites({ facts, router, setFacts })

	const {
		complete,
		editSession,
		finishOnboarding,
		logSession,
		postReel,
		setParticipantGoal,
		submitPhase,
		unsubmitPhase,
	} = useStoreWrites({ facts, router, setFacts })

	// The context value is rebuilt only when one of its members changes, so it keeps its identity across the re-renders the provider takes for reasons of its own. Without that, every consumer of the store re-renders on every navigation, because the provider re-renders with the layout.
	const value = useMemo<Ctx>(
		() => ({
			...facts,
			addProject,
			allCheckpoints,
			bypassCheckpoint,
			bypassLocks,
			complete,
			currentCheckpointId,
			deadlineOf,
			doomscrollerOpen: ceremony.doomscrollerOpen,
			editSession,
			ensureProject,
			finishOnboarding,
			finishTour,
			hoursOf,
			hydrated,
			isHeld,
			isPassed,
			isUnlocked: isOpen,
			linkSyncRepoToProject,
			lockReason,
			logSession,
			openCheckpoint,
			overlapUnchecked,
			passedOf,
			pendingCoins,
			phase,
			phaseStatusOf,
			postReel,
			previewFreestyle,
			// A printer can be paid for out of either pot, so the goal tracker reads the total. Everything else in the shop takes `coins` alone.
			printerFund: facts.coins + facts.bankedCoins,
			redoOnboarding,
			reducedMotion,
			reset,
			setBypassLocks,
			setDoomscroller,
			setOpenCheckpoint,
			setParticipantGoal,
			setPhase,
			setPreviewFreestyle,
			setProjectRepo,
			setProjectTier,
			setSharePost,
			setTourStep,
			sharePost,
			stateOf,
			statusOf,
			submitPhase,
			totalHours,
			tourStep,
			unsubmitPhase,
			updateProject,
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
		}),
		[
			addProject,
			allCheckpoints,
			bypassCheckpoint,
			bypassLocks,
			ceremony,
			complete,
			currentCheckpointId,
			deadlineOf,
			editSession,
			ensureProject,
			facts,
			finishOnboarding,
			finishTour,
			hoursOf,
			hydrated,
			isHeld,
			isOpen,
			isPassed,
			linkSyncRepoToProject,
			lockReason,
			logSession,
			openCheckpoint,
			overlapUnchecked,
			passedOf,
			pendingCoins,
			phase,
			phaseStatusOf,
			postReel,
			previewFreestyle,
			redoOnboarding,
			reducedMotion,
			reset,
			setBypassLocks,
			setPreviewFreestyle,
			setDoomscroller,
			setOpenCheckpoint,
			setParticipantGoal,
			setPhase,
			setProjectRepo,
			setProjectTier,
			setSharePost,
			setTourStep,
			sharePost,
			stateOf,
			statusOf,
			submitPhase,
			totalHours,
			tourStep,
			unsubmitPhase,
			updateProject,
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
			weeks,
			weekStarted,
			weekSubmitted,
		],
	)

	return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Ctx {
	const ctx = useContext(StoreContext)
	if (!ctx) throw new Error("useStore must be used inside StoreProvider")
	return ctx
}

export interface PrinterPace {
	/**
	 * Weeks before this one that closed without an approval, most recent first. Coins only come from an approved week, so these are coins nobody can earn back – which is the whole of the printer's fine print, and what both surfaces below need to say.
	 */
	missedWeeks: number[]
	/** Coins a design week has to earn to stay on that machine's pace. */
	perWeekCoins: number
	/** The machine being saved for. Null when this participant is here for the grant, where there is no pace to miss. */
	printer: PrinterGoal | null
}

/**
 * How someone is doing against the printer they are saving for, for the two places that have to say so.
 *
 * One definition rather than two, because the goal sheet and the new-project sheet both ask the same two questions – what pace does this machine need, and has any week already closed without being approved – and the answer has to be the same in both or the platform is arguing with itself about whether somebody is behind.
 *
 * Only a printer has a pace. A funding-only answer returns a null printer rather than a default machine, so a caller that has not checked falls back to its own wording instead of warning someone about a goal they never set.
 */
export function usePrinterPace(): PrinterPace {
	const { goalId, participantGoal, weeks, weekPassed, statusOf } = useStore()
	const printer = participantGoal === null || participantGoal === ParticipantGoal.PRINTER ? printerById(goalId) : null
	// A week that closed while still a draft holds nothing reviewable, and a rejected one was decided against; neither will pay now. A week in review, or one sent back for changes, is deliberately not counted: it can still be decided and still pay, and telling someone they are behind on a week a reviewer has not opened yet is a nag with no action behind it.
	const missedWeeks = weeks
		.filter(w => weekPassed(w.id) && (statusOf(w) === "draft" || statusOf(w) === "rejected"))
		.map(w => w.id)
		.toReversed()
	return { missedWeeks, perWeekCoins: printer ? Math.round(printer.paceHours * COINS_PER_HOUR) : 0, printer }
}

/**
 * The weeks a maker has behind them, as they would say it: "Week 2", "Weeks 2 and 4", "Weeks 1, 2 and 4". Newest first, because the most recent miss is the one they remember.
 */
export function weekListPhrase(weeks: readonly number[]): string {
	const parts = weeks.map(String)
	if (parts.length === 0) return "No weeks"
	if (parts.length === 1) return `Week ${parts[0]}`
	return `Weeks ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
}
