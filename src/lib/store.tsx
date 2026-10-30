"use client"

import { useRouter } from "next/navigation"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"
import { errorMessage } from "@/lib/api-error"
import { ParticipantGoal } from "@/lib/enums"
import { COINS_PER_HOUR, type PrinterGoal, printerById } from "./config/printers"
import { DESIGN_WEEKS } from "./config/program"
import { round2 } from "./money"
import type { StoreSnapshot } from "./queries/store"
import { DEFAULT_SESSION_TITLE } from "./schemas/session"
import { type CheckpointState, deriveTrail, EMPTY } from "./trail"
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

export type IntroPhase =
	| "cinematic" // the fly-through
	| "aim" // spotlight on the first checkpoint
	| "checkpoint" // the six-step onboarding modal is open
	| "tour" // spotlight each tab in turn
	| "done"

/**
 * What the browser owns: the first-run ceremony, and nothing else.
 *
 * Kept apart from the facts deliberately. If any of this lived on the server, signing in on a second device would drop you into the middle of a tab tour you had already finished, and a schema migration would be needed to change the order of the intro.
 */
interface Ceremony {
	doomscrollerOpen: boolean
	phase: IntroPhase
	/**
	 * Set by "Replay the intro". Without it the server's word that onboarding is done forces the phase straight back to "done", so the replay cleared the ceremony and then showed nothing. Optional so saves written before it existed read as false.
	 */
	replaying?: boolean
	/**
	 * Set once the tab tour has been finished or skipped. Before week 1 opens a new account gets the intro and the tour but not the Get started checkpoint, so it meets that checkpoint later, and finishing it must not walk the tour a second time. Optional so older saves read as not toured.
	 */
	toured?: boolean
	version: 4
}

const KEY = "halflife.ceremony.v4"

/** The saved ceremony and the API bodies this file reads. Parsed, so a stale or hand-edited localStorage row cannot reach the trail as a wrong shape. */
const CeremonySave = z.object({
	doomscrollerOpen: z.boolean().optional(),
	phase: z.enum(["cinematic", "aim", "checkpoint", "tour", "done"]).optional(),
	replaying: z.boolean().optional(),
	toured: z.boolean().optional(),
	version: z.literal(4),
})
const CreatedProjectBody = z.object({ id: z.string() })
const PostedReelBody = z.object({ post: z.object({ id: z.string() }).optional() })
const LinkSyncRepoBody = z.object({ githubRepo: z.string().nullish() })

/**
 * The admin lock bypass. Kept apart from the ceremony so "Replay the intro", which clears that, leaves it alone.
 */
const BYPASS_KEY = "halflife.bypass-locks"

function seededCeremony(): Ceremony {
	return { doomscrollerOpen: true, phase: "cinematic", version: 4 }
}

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
	editSession(id: string, minutes: number, body: string, evidence?: Pick<SessionLog, "clips">): Promise<string | null>
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
	/**
	 * Point a project's repo link at the repo its sync writes to, when the two drifted apart because the sync's repo was picked after the project's was set. Resolves to null once saved, or the server's reason for refusing; the link is the sync target already, so no URL is taken from the client.
	 */
	linkSyncRepoToProject(id: string): Promise<string | null>
	/** Why a locked checkpoint is locked, phrased for the trail. Null if open. */
	lockReason(id: string): string | null
	/**
	 * Resolves to null once the entry is saved, or to the server's reason for refusing it – Lapse may say a timelapse is not yours, is still processing, or already backs another entry, and the sheet has to stay open to say so.
	 */
	logSession(id: string, minutes: number, body: string, evidence?: Pick<SessionLog, "clips">): Promise<string | null>
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
	/**
	 * Set or clear a project's repo link. Resolves to null once saved, or to the server's reason for refusing (a phase in review, say), so an inline editor can say so instead of quietly reverting.
	 */
	setProjectRepo(id: string, url: string | null): Promise<string | null>
	setProjectTier(id: string, tier: 1 | 2 | 3): void
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
	submitPhase(
		id: string,
		extra?: {
			notes?: string
			attachmentKeys?: string[]
			partialFundingAccepted?: boolean
			fundingDeclined?: boolean
			noMicrocontroller?: boolean
		},
	): Promise<string | null>
	/**
	 * Every hour on the record – journalled in entries and tracked some other way (Hackatime, a reviewer's adjustment) – summed across the season's weeks and every warm-up. Zero until the first session lands.
	 */
	totalHours: number
	tourStep: number
	/**
	 * Take a phase in review back out of it. Null once done, or the server's reason. A trail submit passes its checkpoint id; a project with no checkpoint to address it by (a warm-up project) passes itself directly.
	 */
	unsubmitPhase(target: string | { projectId: string; phase: "DESIGN" | "BUILD" }): Promise<string | null>
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
	 * Whose extension a week's countdown is racing, when it is racing one: `"project"` for the week's own project's, `"account"` for the participant's own – which covers every week at once – or null when the week closes on its own.
	 */
	weekExtension(weekId: number): "account" | "project" | null
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

/**
 * Post JSON and reload the snapshot.
 *
 * Errors are swallowed on purpose. Every caller has already patched local state optimistically, and the `router.refresh()` in the `finally` reloads the server's version either way – so a failed write corrects itself on screen instead of leaving the trail showing something that did not happen.
 */
async function send(path: string, body: unknown, method: "DELETE" | "PATCH" | "POST" = "POST"): Promise<boolean> {
	try {
		const res = await fetch(path, {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
			method,
		})
		return res.ok
	} catch {
		return false
	}
}

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

	const [ceremony, setCeremony] = useState<Ceremony>(seededCeremony)
	const [hydrated, setHydrated] = useState(false)
	const [openCheckpoint, setOpenCheckpoint] = useState<string | null>(null)
	const [sharePost, setSharePost] = useState<SharePost | null>(null)
	const [tourStep, setTourStep] = useState(0)
	const [reducedMotion, setReducedMotion] = useState(false)
	const [bypassing, setBypassing] = useState(false)
	// Single checkpoints an admin opened past their locks. Held in memory only: it is for checking one node, not a setting to come back to.
	const [bypassed, setBypassed] = useState<string[]>([])

	useEffect(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
		const sync = () => setReducedMotion(mq.matches)
		sync()
		mq.addEventListener("change", sync)
		return () => mq.removeEventListener("change", sync)
	}, [])

	// Reading the persisted ceremony is exactly the external-system sync an effect is for: it cannot run during render without breaking SSR hydration, since the server has no localStorage and must render the seeded state.
	useEffect(() => {
		let next: Ceremony | null = null
		try {
			const raw = window.localStorage.getItem(KEY)
			if (raw) {
				const parsed = CeremonySave.safeParse(JSON.parse(raw))
				if (parsed.success) {
					const seed = seededCeremony()
					next = {
						doomscrollerOpen: parsed.data.doomscrollerOpen ?? seed.doomscrollerOpen,
						phase: parsed.data.phase ?? seed.phase,
						replaying: parsed.data.replaying ?? seed.replaying,
						toured: parsed.data.toured ?? seed.toured,
						version: 4,
					}
				}
			}
		} catch {
			/* storage unavailable – run from the seed */
		}
		let bypass = false
		try {
			bypass = window.localStorage.getItem(BYPASS_KEY) === "1"
		} catch {
			/* storage unavailable – the trail stays locked */
		}
		// hydrating from localStorage
		if (next) setCeremony(next)
		if (bypass) setBypassing(true)
		setHydrated(true)
	}, [])

	const setBypassLocks = useCallback((on: boolean) => {
		setBypassing(on)
		try {
			if (on) window.localStorage.setItem(BYPASS_KEY, "1")
			else window.localStorage.removeItem(BYPASS_KEY)
		} catch {
			/* private mode – it lasts the session */
		}
	}, [])
	// Read by role, not by storage alone: a flag left behind on a shared browser, or by an admin since demoted, opens nothing.
	const bypassLocks = facts.viewer.isAdmin && bypassing

	const bypassCheckpoint = useCallback(
		(id: string) => setBypassed(list => (list.includes(id) ? list : [...list, id])),
		[],
	)

	useEffect(() => {
		if (!hydrated) return
		try {
			window.localStorage.setItem(KEY, JSON.stringify(ceremony))
		} catch {
			/* quota or private mode – the session still works, it just will not persist */
		}
	}, [ceremony, hydrated])

	// Someone who has already finished the first checkpoint must never be shown the intro again, whatever a stale or cleared localStorage says. The server is what knows, so it gets the final word – unless they asked for it back. A replay plays the cinematic and the tab tour and goes nowhere near the setup checkpoint: its answers are taken once, and the server refuses a second set, so "aim" and "checkpoint" go straight on to the tour.
	//
	// Before week 1 opens, Get started is shut, so the intro goes from the fly-through straight to the tab tour: "aim" (the spotlight on that checkpoint) and "checkpoint" (its modal) have nothing to point at.
	const phase: IntroPhase = !facts.onboardingDone
		? !weekStarted(1) && (ceremony.phase === "aim" || ceremony.phase === "checkpoint")
			? ceremony.toured
				? "done"
				: "tour"
			: ceremony.phase
		: ceremony.replaying
			? ceremony.phase === "aim" || ceremony.phase === "checkpoint"
				? "tour"
				: ceremony.phase
			: ceremony.phase === "tour"
				? "tour"
				: "done"

	const setPhase = useCallback(
		(next: IntroPhase) =>
			setCeremony(c => {
				// The tour plays once. Someone who took it while week 1 was shut finishes Get started straight onto the trail, not into it again.
				const nextPhase = next === "tour" && c.toured && !c.replaying ? "done" : next
				return {
					...c,
					phase: nextPhase,
					// Finishing or skipping ends the replay, so a later sign-in does not start it again.
					replaying: phase === "done" ? false : c.replaying,
				}
			}),
		[],
	)

	const finishTour = useCallback(() => setCeremony(c => ({ ...c, phase: "done", replaying: false, toured: true })), [])

	// In flight per week, so a checkpoint opened twice in a row asks once.
	const ensuring = useRef(new Map<number, Promise<string | null>>())

	const ensureProject = useCallback(
		(weekId: number): Promise<string | null> => {
			const known = facts.projectIdByWeek[weekId]
			if (known) return Promise.resolve(known)
			const pending = ensuring.current.get(weekId)
			if (pending) return pending
			const request = (async () => {
				try {
					const res = await fetch("/api/projects", {
						body: JSON.stringify({ weekId }),
						headers: { "content-type": "application/json" },
						method: "POST",
					})
					if (!res.ok) return null
					const { id } = CreatedProjectBody.parse(await res.json())
					setFacts(f => ({ ...f, projectIdByWeek: { ...f.projectIdByWeek, [weekId]: id } }))
					return id
				} catch {
					return null
				} finally {
					ensuring.current.delete(weekId)
				}
			})()
			ensuring.current.set(weekId, request)
			return request
		},
		[facts.projectIdByWeek],
	)

	/**
	 * Naming a week's project – filling in the row its checkpoint made when it was opened (ensureProject). A second project for the same week is refused rather than queued behind the first, where nothing would ever read it.
	 */
	const addProject = useCallback(
		(p: Omit<Project, "id">) => {
			void (async () => {
				try {
					// Normally made when the checkpoint opened; made here if that request had not landed yet, so a quick "Create project" still has a row.
					const id = await ensureProject(p.weekId)
					if (!id) return
					setFacts(f =>
						f.projects.some(existing => existing.weekId === p.weekId)
							? f
							: { ...f, projects: [...f.projects, { ...p, id }] },
					)
					await send(
						`/api/projects/${id}`,
						{
							description: p.description,
							requestedTier: p.tier,
							title: p.name,
							...(p.githubRepo ? { githubRepo: p.githubRepo } : {}),
							...(p.starterProjectId !== undefined ? { starterProjectId: p.starterProjectId } : {}),
						},
						"PATCH",
					)
				} finally {
					router.refresh()
				}
			})()
		},
		[ensureProject, router],
	)

	/**
	 * `requestedTier`, never `tier`.
	 *
	 * The assigned tier is a reviewer's decision at design approval, because it is parts money. This is the participant saying which one they are aiming at, and the API refuses to write anything else.
	 */
	const setProjectRepo = useCallback(
		async (id: string, url: string | null): Promise<string | null> => {
			let res: Response
			try {
				res = await fetch(`/api/projects/${id}`, {
					body: JSON.stringify({ githubRepo: url }),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				})
			} catch {
				return "Could not reach the server. Try again."
			}
			if (!res.ok) {
				const err: unknown = await res.json().catch(() => null)
				return errorMessage(err, "That did not save. Try again.")
			}
			setFacts(f => ({
				...f,
				projects: f.projects.map(p => (p.id === id ? { ...p, githubRepo: url } : p)),
			}))
			router.refresh()
			return null
		},
		[router],
	)

	const linkSyncRepoToProject = useCallback(
		async (id: string): Promise<string | null> => {
			let res: Response
			try {
				res = await fetch(`/api/projects/${id}/link-sync-repo`, { method: "POST" })
			} catch {
				return "Could not reach the server. Try again."
			}
			const body: unknown = await res.json().catch(() => null)
			if (!res.ok) return errorMessage(body, "That did not save. Try again.")
			const parsed = LinkSyncRepoBody.safeParse(body)
			const url = parsed.success ? (parsed.data.githubRepo ?? null) : null
			setFacts(f => ({
				...f,
				projects: f.projects.map(p => (p.id === id ? { ...p, githubRepo: url } : p)),
			}))
			router.refresh()
			return null
		},
		[router],
	)

	const updateProject = useCallback(
		async (id: string, patch: ProjectPatch): Promise<string | null> => {
			let res: Response
			try {
				res = await fetch(`/api/projects/${id}`, {
					body: JSON.stringify({
						...(patch.name !== undefined ? { title: patch.name } : {}),
						...(patch.description !== undefined ? { description: patch.description } : {}),
						...(patch.coverImageKey !== undefined ? { coverImageKey: patch.coverImageKey } : {}),
						...(patch.githubRepo !== undefined ? { githubRepo: patch.githubRepo } : {}),
						...(patch.tier !== undefined ? { requestedTier: patch.tier } : {}),
						...(patch.starterProjectId !== undefined ? { starterProjectId: patch.starterProjectId } : {}),
					}),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				})
			} catch {
				return "Could not reach the server. Try again."
			}
			if (!res.ok) {
				const err: unknown = await res.json().catch(() => null)
				return errorMessage(err, "That did not save. Try again.")
			}
			setFacts(f => ({
				...f,
				projects: f.projects.map(p =>
					p.id === id
						? {
								...p,
								...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
								...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
								...(patch.githubRepo !== undefined ? { githubRepo: patch.githubRepo } : {}),
								...(patch.coverImageKey !== undefined ? { coverImageKey: patch.coverImageKey } : {}),
								...(patch.tier !== undefined ? { tier: patch.tier } : {}),
								...(patch.starterProjectId !== undefined
									? { starter: patch.starterProjectId !== null, starterProjectId: patch.starterProjectId }
									: {}),
							}
						: p,
				),
			}))
			router.refresh()
			return null
		},
		[router],
	)

	const setProjectTier = useCallback(
		(id: string, tier: 1 | 2 | 3) => {
			setFacts(f => ({
				...f,
				projects: f.projects.map(p => (p.id === id ? { ...p, tier } : p)),
			}))
			void (async () => {
				try {
					await send(`/api/projects/${id}`, { requestedTier: tier }, "PATCH")
				} finally {
					router.refresh()
				}
			})()
		},
		[router],
	)

	/** The project and phase a checkpoint id belongs to. */
	const routeOf = useCallback(
		(checkpointId: string): { projectId: string; phase: "DESIGN" | "BUILD" } | null => {
			// A warm-up's checkpoints carry their project: several share no week.
			const warmup = /^wu-([A-Za-z0-9_]+)-(?:entry-\d+|submit|reel-submission)$/.exec(checkpointId)
			if (warmup?.[1]) {
				const info = facts.warmups[warmup[1]]
				return info ? { phase: info.phase === "build" ? "BUILD" : "DESIGN", projectId: warmup[1] } : null
			}
			const weekId = Number(/^w(\d+)-/.exec(checkpointId)?.[1])
			if (!Number.isInteger(weekId) || weekId < 0) return null
			const designWeek = weekId > DESIGN_WEEKS ? weekId - DESIGN_WEEKS : weekId
			const projectId = facts.projectIdByWeek[designWeek]
			if (!projectId) return null
			return { phase: weekId > DESIGN_WEEKS ? "BUILD" : "DESIGN", projectId }
		},
		[facts.projectIdByWeek, facts.warmups],
	)

	const patchCheckpoint = useCallback(
		(id: string, patch: Partial<CheckpointState>) =>
			setFacts(f => {
				const prev = { ...EMPTY, ...f.progress[id] }
				return {
					...f,
					progress: {
						...f.progress,
						// The first completion is the one that dates it. Redoing a checkpoint should not move it up the project timeline past work that came after it.
						[id]: { ...prev, ...patch, at: prev.at ?? Date.now(), done: true },
					},
				}
			}),
		[],
	)

	/**
	 * Mark a checkpoint done.
	 *
	 * Which write that means depends on the node, because the trail's nodes are derived from real records rather than stored as a list of ticks: a reel is a post, a submission is a submission, and the first checkpoint is the onboarding flow's own business.
	 */
	const complete = useCallback(
		(id: string, patch: Partial<CheckpointState> = {}) => {
			patchCheckpoint(id, patch)

			const route = routeOf(id)
			if (route && id.endsWith("-submit")) {
				void (async () => {
					try {
						await send(`/api/projects/${route.projectId}/submit`, { phase: route.phase })
					} finally {
						router.refresh()
					}
				})()
				return
			}

			// Reels are posted by the reel modal, which has to upload the video before there is anything to post; the first checkpoint is written by the onboarding API as its steps are answered. Both arrive back through the snapshot, so there is nothing to send here.
			router.refresh()
		},
		[patchCheckpoint, routeOf, router],
	)

	/**
	 * Post a reel against the node that asked for it.
	 *
	 * `checkpointKey` is what binds the post to the node, and it has to: the 5h and the 15h reel are both PROGRESS, so counting posts by kind would tick the 15h node the moment the 5h one landed.
	 */
	// Resolves to the new post's id – what a public link gets attached to – or to the reason it did not land. The node is patched first either way, and the refresh puts the truth back if the write failed.
	const postReel = useCallback(
		async (id: string, caption: string, objectKey: string): Promise<PostReelResult> => {
			patchCheckpoint(id, { artefacts: 1, caption })
			const route = routeOf(id)
			let res: Response
			try {
				res = await fetch("/api/posts", {
					body: JSON.stringify({
						caption,
						checkpointKey: id,
						// Three occasions, three kinds: the pitch at the start of a design week, the ones that mark the hours, and the one that closes a week inside Submit.
						kind: id.endsWith("-reel-idea") ? "IDEA" : id.endsWith("-reel-submission") ? "SUBMISSION" : "PROGRESS",
						objectKey,
						themeProjectId: route?.projectId ?? null,
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				})
			} catch {
				// The one case the old wording was actually right for: the request never arrived.
				return { error: "Your reel didn't post. Check your connection and try again." }
			} finally {
				router.refresh()
			}
			if (!res.ok) {
				// No `data` envelope: ok() returns the payload itself, and only a failure is wrapped. See lib/api.ts.
				const err: unknown = await res.json().catch(() => null)
				return { error: errorMessage(err, `Your reel didn't post (error ${res.status}).`) }
			}
			// Re-recording an owed reel lifts the hold now rather than on the refresh, so the map opens back up the moment it is posted.
			setFacts(f => (f.owedReels.includes(id) ? { ...f, owedReels: f.owedReels.filter(k => k !== id) } : f))
			const body = PostedReelBody.safeParse(await res.json())
			const postId = body.success ? body.data.post?.id : undefined
			return postId ? { postId } : { error: "Your reel didn't post. Try again." }
		},
		[patchCheckpoint, routeOf, router],
	)

	// Server first, like logSession: the submit route runs the repo checks and can refuse, and a week shown as handed in that then quietly reopens on the next refresh is worse than a sheet that says what is wrong.
	const submitPhase = useCallback(
		async (
			id: string,
			extra: {
				notes?: string
				attachmentKeys?: string[]
				partialFundingAccepted?: boolean
				fundingDeclined?: boolean
				noMicrocontroller?: boolean
			} = {},
		): Promise<string | null> => {
			const route = routeOf(id)
			if (!route) return "This week has no project to submit."
			let res: Response
			try {
				res = await fetch(`/api/projects/${route.projectId}/submit`, {
					body: JSON.stringify({
						phase: route.phase,
						...(extra.notes ? { notes: extra.notes } : {}),
						attachmentKeys: extra.attachmentKeys ?? [],
						// Only ever sent as true, so a stale tick from a cart that has since shrunk cannot ride along on the next one. Same for a declined grant: the server records what this hand-in said, not what a previous one did.
						...(extra.partialFundingAccepted ? { partialFundingAccepted: true } : {}),
						...(extra.fundingDeclined ? { fundingDeclined: true } : {}),
						...(extra.noMicrocontroller ? { noMicrocontroller: true } : {}),
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				})
			} catch {
				return "Could not reach the server. Nothing was submitted. Try again."
			}
			if (!res.ok) {
				const err: unknown = await res.json().catch(() => null)
				return errorMessage(err, "The week was not submitted. Try again.")
			}
			patchCheckpoint(id, {})
			router.refresh()
			return null
		},
		[patchCheckpoint, routeOf, router],
	)

	/**
	 * Take a handed-in week back out of review, so it can be changed and handed in again. Only a week still waiting for a reviewer can be – the server refuses once a decision is made, or while a reviewer has it open.
	 *
	 * A checkpoint id resolves to its project through `projectIdByWeek`, which works for the trail. A warm-up project has no checkpoint: several of them share week 0, so a week id cannot say which one, and the caller names the project and phase instead.
	 */
	const unsubmitPhase = useCallback(
		async (target: string | { projectId: string; phase: "DESIGN" | "BUILD" }): Promise<string | null> => {
			const fromCheckpoint = typeof target === "string"
			const route = fromCheckpoint ? routeOf(target) : { phase: target.phase, projectId: target.projectId }
			if (!route) return "This week has no project to unsubmit."
			let res: Response
			try {
				res = await fetch(`/api/projects/${route.projectId}/unsubmit`, {
					body: JSON.stringify({ phase: route.phase }),
					headers: { "content-type": "application/json" },
					method: "POST",
				})
			} catch {
				return "Could not reach the server. Nothing changed. Try again."
			}
			if (!res.ok) {
				const err: unknown = await res.json().catch(() => null)
				return errorMessage(err, "The week was not unsubmitted. Try again.")
			}
			if (fromCheckpoint) {
				const weekId = Number(/^w(\d+)-/.exec(target)?.[1])
				if (Number.isInteger(weekId))
					setFacts(f => ({
						...f,
						phaseStatusByWeek: { ...f.phaseStatusByWeek, [weekId]: "draft" },
						progress: { ...f.progress, [target]: { ...EMPTY, ...f.progress[target], done: false } },
					}))
			}
			router.refresh()
			return null
		},
		[routeOf, router],
	)

	const setDoomscroller = useCallback((doomscrollerOpen: boolean) => setCeremony(c => ({ ...c, doomscrollerOpen })), [])

	/**
	 * The first checkpoint answered its last question.
	 *
	 * Patched here rather than left to the refresh that follows, because the gate that holds the goal prompt open is `onboardingDone && participantGoal === null`. Waiting for the round-trip would put the tab tour's spotlight on screen for the length of the request and then cover it with the prompt. The API has already confirmed this, so it is a fact and not a guess.
	 */
	const finishOnboarding = useCallback(() => {
		setFacts(f => ({ ...f, onboardingDone: true }))
	}, [])

	/**
	 * Record what this participant is here for.
	 *
	 * Unlike everything else in here, this one reports its failures instead of swallowing them, and it does NOT patch optimistically. The prompt that calls it is uncloseable: if the facts flipped before the write landed, a refused save would close the modal on the spot and unmount the error with it, leaving somebody stuck behind a prompt that looks finished and says nothing about why. So the gate opens only once the server agrees.
	 *
	 * Resolves to null once saved, or to the server's reason for refusing.
	 */
	const setParticipantGoal = useCallback(
		async (goal: ParticipantGoal, printerGoalId?: string): Promise<string | null> => {
			let refusal: string | null = null
			try {
				const res = await fetch("/api/goal", {
					body: JSON.stringify(printerGoalId ? { goal, printerGoalId } : { goal }),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				})
				if (res.ok) setFacts(f => ({ ...f, goalId: printerGoalId ?? f.goalId, participantGoal: goal }))
				else {
					const err: unknown = await res.json().catch(() => null)
					refusal = errorMessage(err, "That did not save. Try again.")
				}
			} catch {
				refusal = "Could not reach the server. Try again."
			}

			// Either way the server has the last word, so a write that landed elsewhere while this one was refused cannot sit on top of it.
			router.refresh()
			return refusal
		},
		[router],
	)

	/**
	 * Replay the first run.
	 *
	 * Ceremony only. It cannot un-log a session or un-post a reel, and pretending otherwise would be the more surprising behaviour: the trail comes back exactly as it was, with the intro playing over it.
	 */
	const reset = useCallback(() => {
		try {
			window.localStorage.removeItem(KEY)
		} catch {
			/* nothing to clear */
		}
		setCeremony({ ...seededCeremony(), replaying: true })
		setTourStep(0)
		setOpenCheckpoint(null)
	}, [])

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
		try {
			window.localStorage.removeItem(KEY)
		} catch {
			/* nothing to clear */
		}
		setFacts(f => ({ ...f, onboardingDone: false }))
		setCeremony(seededCeremony())
		setTourStep(0)
		setOpenCheckpoint(null)
		router.refresh()
		return null
	}, [router])

	/**
	 * One saved journal: the entry, the time claimed, and the evidence for it.
	 *
	 * Note what this does NOT do any more: credit coins. Hours are paid for when a reviewer approves the phase, not when they are claimed – otherwise the currency is self-issued, and a week could be spent in the shop before anyone had looked at it. The trail still moves immediately, because the node is the entry rather than the payment.
	 */
	const logSession = useCallback(
		async (id: string, minutes: number, body: string, evidence?: Pick<SessionLog, "clips">): Promise<string | null> => {
			const clips = evidence?.clips ?? []
			// Server first, unlike the other writes here. An entry's timelapses are checked against Lapse, and a refusal is something the maker has to fix in the sheet – patching the trail first would show a node done for an entry that was never saved.
			const route = routeOf(id)
			if (route) {
				let res: Response
				try {
					res = await fetch(`/api/projects/${route.projectId}/sessions`, {
						body: JSON.stringify({
							content: body,
							hoursClaimed: round2(minutes / 60),
							phase: route.phase,
							timelapses: clips.map(lapseId => ({ lapseId })),
							// The journal's first line stands in for a title. The form asks for one piece of writing, and inventing a second field to satisfy the column would put a box on screen that exists only because of the schema.
							title: body.trim().split("\n")[0]?.slice(0, 200) || DEFAULT_SESSION_TITLE,
						}),
						headers: { "content-type": "application/json" },
						method: "POST",
					})
				} catch {
					return "Could not reach the server. Your entry is still here. Try again."
				}
				if (!res.ok) {
					const err: unknown = await res.json().catch(() => null)
					return errorMessage(err, "The entry was not saved. Try again.")
				}
			}

			setFacts(f => {
				const prev = { ...EMPTY, ...f.progress[id] }
				const entry: SessionLog = {
					at: Date.now(),
					body,
					clips,
					id: `${id}-s${prev.log.length + 1}`,
					minutes,
				}
				return {
					...f,
					progress: {
						...f.progress,
						[id]: {
							...prev,
							at: prev.at ?? Date.now(),
							done: true,
							log: [...prev.log, entry],
							minutes: prev.minutes + minutes,
						},
					},
				}
			})
			router.refresh()
			return null
		},
		[routeOf, router],
	)

	/**
	 * Change a finished entry's words, hours, and timelapses. The node stays where it is – this is the same session, corrected, not another one.
	 *
	 * Server first, like logSession: the server can refuse (an entry a reviewer has already put hours on, a week in review or passed, a timelapse that is not yours or already backs another entry), and an edit shown as saved that quietly reverts on the next refresh is worse than a sheet that says why it did not take.
	 */
	const editSession = useCallback(
		async (id: string, minutes: number, body: string, evidence?: Pick<SessionLog, "clips">): Promise<string | null> => {
			const clips = evidence?.clips ?? []
			const route = routeOf(id)
			const entry = facts.progress[id]?.log[0]
			if (!route || !entry) return "That entry could not be found. Refresh and try again."
			let res: Response
			try {
				res = await fetch(`/api/projects/${route.projectId}/sessions/${entry.id}`, {
					body: JSON.stringify({
						content: body,
						hoursClaimed: round2(minutes / 60),
						timelapses: clips.map(lapseId => ({ lapseId })),
						title: body.trim().split("\n")[0]?.slice(0, 200) || DEFAULT_SESSION_TITLE,
					}),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				})
			} catch {
				return "Could not reach the server. Your changes are still here. Try again."
			}
			if (!res.ok) {
				const err: unknown = await res.json().catch(() => null)
				return errorMessage(err, "The entry was not saved. Try again.")
			}
			setFacts(f => {
				const prev = { ...EMPTY, ...f.progress[id] }
				return {
					...f,
					progress: {
						...f.progress,
						[id]: {
							...prev,
							log: prev.log.map((l, i) => (i === 0 ? Object.assign({}, l, { body, clips, minutes }) : l)),
							minutes,
						},
					},
				}
			})
			router.refresh()
			return null
		},
		[routeOf, facts.progress, router],
	)

	// What the trail lets you click. An admin bypassing the locks, all of them or one node, can open anything; the server still has the last word on whatever is saved from a node opened that way. "Start here" keeps to the real rules above.
	const isOpen = useCallback(
		(id: string) => bypassLocks || (facts.viewer.isAdmin && bypassed.includes(id)) || isUnlocked(id),
		[bypassLocks, facts.viewer.isAdmin, bypassed, isUnlocked],
	)

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
			redoOnboarding,
			reducedMotion,
			reset,
			setBypassLocks,
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
