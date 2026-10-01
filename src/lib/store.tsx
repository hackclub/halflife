"use client"

import { useRouter } from "next/navigation"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { COINS_PER_HOUR, printerById, submitFloorFor, weekAsk } from "./config/printers"
import { DESIGN_WEEKS, ONBOARDING_CHECKPOINT_ID, WARMUP_THEME, WARMUP_WEEK_ID } from "./config/program"
import { BUILD_HOURS, checkpointsFor, TIERS, WEEK_META } from "./curriculum"
import { formatDeadline } from "./deadline"
import type { StoreSnapshot } from "./queries/store"
import type { Checkpoint, Experience, Project, SessionLog, Week, WeekMeta } from "./types"

/**
 * The trail's store, backed by the database.
 *
 * ## The split
 *
 * Facts come from the server, as a `StoreSnapshot` loaded once per navigation
 * by the `(app)` layout: projects, checkpoint states, coins, streak, goal.
 * Ceremony stays in `localStorage`: whether the cinematic has played, how far
 * the tab tour got, whether the Doomscroller rail is open. Nobody else ever
 * needs to read the ceremony, and a new laptop replaying the intro is a feature
 * rather than a bug.
 *
 * ## Why the derivation did not change
 *
 * Everything below `weeks` — the shape of a week, which node is live, what is
 * locked and why — is computed exactly as it was when the data was a toy, by
 * `curriculum.checkpointsFor`. The server says which checkpoints are done and
 * with what; it does not say what a week looks like. A second checkpoint engine
 * on the server would have been a second answer to "have I finished this week",
 * and the first time the two disagreed the trail would have lied to someone
 * about work they had really done.
 *
 * ## Writes
 *
 * Every mutation posts to the API and then asks Next to re-render the layout,
 * which reloads the snapshot. Each one also patches local state first, because
 * a round trip to Postgres between clicking a node and seeing it fill is long
 * enough to feel broken — and if the request fails the refresh puts the truth
 * back.
 */

export type IntroPhase =
	| "cinematic" // the fly-through
	| "aim" // spotlight on the first checkpoint
	| "checkpoint" // the six-step onboarding modal is open
	| "tour" // spotlight each tab in turn
	| "done"

export interface CheckpointState {
	done: boolean
	/** When it was completed, epoch ms. Undefined on saves written before this. */
	at?: number
	/** A reel's caption, kept so the project timeline can show what was posted. */
	caption?: string
	/** Journal checkpoints accumulate minutes toward their target. */
	minutes: number
	/** Reel / submit checkpoints record how many artefacts were attached. */
	artefacts: number
	/** Every saved journal session in this checkpoint, newest last. */
	log: SessionLog[]
}

/**
 * What the browser owns: the first-run ceremony, and nothing else.
 *
 * Kept apart from the facts deliberately. If any of this lived on the server,
 * signing in on a second device would drop you into the middle of a tab tour
 * you had already finished, and a schema migration would be needed to change
 * the order of the intro.
 */
interface Ceremony {
	version: 4
	phase: IntroPhase
	doomscrollerOpen: boolean
	/**
	 * Set by "Replay the intro". Without it the server's word that onboarding
	 * is done forces the phase straight back to "done", so the replay cleared
	 * the ceremony and then showed nothing. Optional so saves written before it
	 * existed read as false.
	 */
	replaying?: boolean
	/**
	 * Set once the tab tour has been finished or skipped. Before week 1 opens a
	 * new account gets the intro and the tour but not the Get started
	 * checkpoint, so it meets that checkpoint later, and finishing it must not
	 * walk the tour a second time. Optional so older saves read as not toured.
	 */
	toured?: boolean
}

const KEY = "halflife.ceremony.v4"

const EMPTY: CheckpointState = { done: false, minutes: 0, artefacts: 0, log: [] }

/** What a checkpoint on a passed week says when it is hovered. */
export const PASSED_REASON = "This week has passed!"

/**
 * A warm-up project's own week: a chain of entries with one live one waiting,
 * then its single submit, keyed `wu-<project id>-…` because a maker may hold
 * several warm-ups and none of them has a week number. The same tier floors as
 * a season week, since it is handed in the same way.
 */
function warmupWeek(project: Project, build: boolean, isDone: (id: string) => boolean): Week {
	const key = (suffix: string) => `wu-${project.id}-${suffix}`
	const tier = TIERS.find((t) => t.id === project.tier) ?? TIERS[0]
	const submitHours = build ? BUILD_HOURS : submitFloorFor(tier.fundingHours)
	const meta: WeekMeta = {
		id: WARMUP_WEEK_ID,
		phase: build ? "build" : "design",
		theme: WARMUP_THEME.label,
		headline: "WARM UP",
		fullName: "Warm-up project",
		summary: "Any hardware project, before week 1 opens.",
		primer: "",
		examples: [],
		accent: "var(--color-violet-pale)",
		accentDeep: "var(--color-violet-deep)",
	}
	let written = 0
	while (isDone(key(`entry-${written + 1}`))) written += 1
	const entries: Checkpoint[] = Array.from({ length: written + 1 }, (_, i) => ({
		id: key(`entry-${i + 1}`),
		weekId: WARMUP_WEEK_ID,
		kind: "journal",
		title: `Entry ${i + 1}`,
		blurb: "Journal your progress with pictures and screenshots!",
		entryTarget: 1,
	}))
	return {
		...meta,
		projectId: project.id,
		tier: tier.id,
		fundingHours: build ? BUILD_HOURS : tier.fundingHours,
		bankedFrom: build ? 0 : tier.fundingHours,
		targetHours: submitHours,
		submitHours,
		checkpoints: [
			...entries,
			{
				id: key("submit"),
				weekId: WARMUP_WEEK_ID,
				kind: "submit",
				title: build ? "Submit your build" : "Submit your design",
				blurb: "Hand in your warm-up project.",
			},
		],
	}
}

function seededCeremony(): Ceremony {
	return { version: 4, phase: "cinematic", doomscrollerOpen: true }
}

/** The details a maker can change on their own project, all optional. */
export interface ProjectPatch {
	name?: string
	description?: string
	coverImageKey?: string | null
	githubRepo?: string | null
	tier?: 1 | 2 | 3
}

interface Ctx {
	/** Who is signed in. Display fields only. */
	viewer: StoreSnapshot["viewer"]
	phase: IntroPhase
	doomscrollerOpen: boolean
	experience: Experience | null
	projects: Project[]
	progress: Record<string, CheckpointState>
	/** Ordinary coins — what the shop will take for anything but a printer. */
	coins: number
	/** The printer fund: earned, ring-fenced, and spendable on a printer only. */
	bankedCoins: number
	/** Both pots. A printer can be paid for out of either, so this is the goal. */
	printerFund: number
	/**
	 * Coins the logged hours of weeks 1..weekId will bank once reviewed, that
	 * are not in `printerFund` yet. Coins are minted at approval, so the fund
	 * alone says a week nobody has reviewed banked nothing; pacing reads both.
	 */
	pendingCoins: (weekId: number) => number
	streak: number
	/** The printer every banked coin is aimed at. See config/printers. */
	goalId: string
	/** Whether the first checkpoint has been completed. */
	onboardingDone: boolean
	hydrated: boolean
	/** id of the checkpoint whose modal is open, if any */
	openCheckpoint: string | null
	tourStep: number
	reducedMotion: boolean

	setPhase: (p: IntroPhase) => void
	/** End the tab tour, finished or skipped, and remember it was seen. */
	finishTour: () => void
	setTourStep: (n: number) => void
	addProject: (p: Omit<Project, "id">) => void
	/**
	 * Make the project row for a design week, if there is none yet, and resolve
	 * to its id (null if the server refused). Called when a "create a project"
	 * checkpoint is opened, which is the only moment a project row is made.
	 */
	ensureProject: (weekId: number) => Promise<string | null>
	setProjectTier: (id: string, tier: 1 | 2 | 3) => void
	/**
	 * Set or clear a project's repo link. Resolves to null once saved, or to the
	 * server's reason for refusing (a phase in review, say), so an inline editor
	 * can say so instead of quietly reverting.
	 */
	setProjectRepo: (id: string, url: string | null) => Promise<string | null>
	/**
	 * Point a project's repo link at the repo its sync writes to, when the two
	 * drifted apart because the sync's repo was picked after the project's was
	 * set. Resolves to null once saved, or the server's reason for refusing; the
	 * link is the sync target already, so no URL is taken from the client.
	 */
	linkSyncRepoToProject: (id: string) => Promise<string | null>
	/** Change any of a project's own details in one save. Null once saved, or why it was refused. */
	updateProject: (id: string, patch: ProjectPatch) => Promise<string | null>
	complete: (id: string, patch?: Partial<CheckpointState>) => void
	/**
	 * Post the reel a checkpoint is asking for. The video is already uploaded.
	 * Resolves to the new post's id, or null if it did not land.
	 */
	postReel: (id: string, caption: string, objectKey: string) => Promise<string | null>
	/** Hand a week in, with its notes and whatever evidence it collected. */
	/** Resolves to null once submitted, or the server's reason for refusing. */
	submitPhase: (id: string, extra?: { notes?: string; attachmentKeys?: string[] }) => Promise<string | null>
	/**
	 * Resolves to null once the entry is saved, or to the server's reason for
	 * refusing it — Lapse may say a timelapse is not yours, is still processing,
	 * or already backs another entry, and the sheet has to stay open to say so.
	 */
	logSession: (
		id: string,
		minutes: number,
		body: string,
		evidence?: Pick<SessionLog, "clips">,
	) => Promise<string | null>
	/** Correct a finished entry's words and hours. Null once saved, or why it was refused. */
	editSession: (id: string, minutes: number, body: string) => Promise<string | null>
	stateOf: (id: string) => CheckpointState
	isUnlocked: (id: string) => boolean
	/** Whether a checkpoint is shut because its week's time ran out. */
	isPassed: (id: string) => boolean
	/** Whether a checkpoint is held until a deleted reel is re-recorded. */
	isHeld: (id: string) => boolean
	/** Whether a week's 11:59 PM Sunday close (or its extension) is behind us. */
	weekPassed: (weekId: number) => boolean
	/** Whether a week's Monday-midnight open is behind us. Nothing on it opens before. */
	weekStarted: (weekId: number) => boolean
	/** The day a week opens, e.g. "Monday, October 5", in the program's timezone. */
	weekOpensOn: (weekId: number) => string | null
	/** When a week stops taking work, e.g. "Sunday, October 5 at 11:59 PM", its extension included. */
	weekDeadline: (weekId: number) => string | null
	/** When warm-ups stop taking work: 11:59 PM the night before week 1 opens. */
	warmupDeadline: string
	/** Whether a week is handed in — in review, approved or rejected — so its entries are final. */
	weekSubmitted: (weekId: number) => boolean
	/** Where a week stands with review. "draft" when nothing is recorded. */
	phaseStatusOf: (weekId: number) => string
	/**
	 * Take a phase in review back out of it. Null once done, or the server's
	 * reason. A trail submit passes its checkpoint id; a project with no
	 * checkpoint to address it by (a warm-up project) passes itself directly.
	 */
	unsubmitPhase: (target: string | { projectId: string; phase: "DESIGN" | "BUILD" }) => Promise<string | null>
	/** Why a locked checkpoint is locked, phrased for the trail. Null if open. */
	lockReason: (id: string) => string | null
	currentCheckpointId: string | null
	/** The trail, cut to the tier of each week's project. */
	weeks: Week[]
	/**
	 * A warm-up project's own week, or null. Never drawn on the trail, but its
	 * entries and its one submit are real checkpoints (`wu-<id>-…`), so the
	 * season's journal and submit sheets serve it from its project page. A maker
	 * may hold several, which is why these are found by project, not number.
	 */
	warmupWeekOf: (projectId: string) => Week | null
	/** The week a checkpoint belongs to: a season week, or a warm-up's own. */
	weekOfCheckpoint: (checkpoint: Checkpoint) => Week
	/** What a week is worth, a warm-up's included. See `weekHours`. */
	hoursOf: (week: Week) => number
	/** Whether a week's journal has closed, a warm-up's included. */
	passedOf: (week: Week) => boolean
	/** Where a week stands with review, a warm-up's included. */
	statusOf: (week: Week) => string
	/** When a week stops taking entries, a warm-up's included. */
	deadlineOf: (week: Week) => string | null
	allCheckpoints: Checkpoint[]
	weekOf: (weekId: number) => Week
	/** Hours logged across every session checkpoint in a week. */
	weekHours: (weekId: number) => number
	setOpenCheckpoint: (id: string | null) => void
	setDoomscroller: (open: boolean) => void
	setGoal: (id: string) => void
	reset: () => void
	/**
	 * Admins only: wipe your own setup answers and run the whole first run
	 * again, setup checkpoint included. Resolves to an error message, or null.
	 */
	redoOnboarding: () => Promise<string | null>
}

const StoreContext = createContext<Ctx | null>(null)

/**
 * Post JSON and reload the snapshot.
 *
 * Errors are swallowed on purpose. Every caller has already patched local state
 * optimistically, and the `router.refresh()` in the `finally` reloads the
 * server's version either way — so a failed write corrects itself on screen
 * instead of leaving the trail showing something that did not happen.
 */
async function send(path: string, body: unknown, method = "POST"): Promise<boolean> {
	try {
		const res = await fetch(path, {
			method,
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		})
		return res.ok
	} catch {
		return false
	}
}

export function StoreProvider({ snapshot, children }: { snapshot: StoreSnapshot; children: ReactNode }) {
	const router = useRouter()

	// Server state as the starting point, patched locally while a write is in
	// flight. Re-seeded from props during render rather than in an effect: an
	// effect would paint one frame of stale data every time a refresh lands.
	const [facts, setFacts] = useState<StoreSnapshot>(snapshot)
	const [seen, setSeen] = useState<StoreSnapshot>(snapshot)
	// The clock the week locks read. Seeded from the server's, so the first
	// paint matches the server render, and moved on only when a week closes.
	const [now, setNow] = useState(snapshot.now)
	if (seen !== snapshot) {
		setSeen(snapshot)
		setFacts(snapshot)
		setNow(snapshot.now)
	}

	// A trail left open over midnight greys a closing week out, and opens a
	// starting one, on the stroke of it rather than on the next navigation.
	// Timers top out at about 24.8 days, so a moment further off than that just
	// re-arms when this one fires.
	useEffect(() => {
		const next = [
			...Object.values(facts.weekClosesAt),
			...Object.values(facts.weekOpensAt),
			...Object.values(facts.warmups).map((w) => w.closesAt),
		]
			.filter((at) => at > now)
			.sort((a, b) => a - b)[0]
		if (next === undefined) return
		const t = window.setTimeout(() => setNow(Date.now()), Math.min(next - now, 2 ** 31 - 1))
		return () => window.clearTimeout(t)
	}, [facts.weekClosesAt, facts.weekOpensAt, facts.warmups, now])

	const weekPassed = useCallback(
		(weekId: number) => {
			const closesAt = facts.weekClosesAt[weekId]
			return closesAt !== undefined && now >= closesAt
		},
		[facts.weekClosesAt, now],
	)

	const weekStarted = useCallback(
		(weekId: number) => {
			const opensAt = facts.weekOpensAt[weekId]
			return opensAt === undefined || now >= opensAt
		},
		[facts.weekOpensAt, now],
	)

	const dayLabel = useCallback(
		(at: number) =>
			new Date(at).toLocaleDateString("en-US", {
				timeZone: facts.programTimezone,
				weekday: "long",
				month: "long",
				day: "numeric",
			}),
		[facts.programTimezone],
	)
	const weekOpensOn = useCallback(
		(weekId: number) => {
			const at = facts.weekOpensAt[weekId]
			return at === undefined ? null : dayLabel(at)
		},
		[facts.weekOpensAt, dayLabel],
	)
	const weekDeadline = useCallback(
		(weekId: number) => {
			const at = facts.weekClosesAt[weekId]
			return at === undefined ? null : formatDeadline(at, facts.programTimezone)
		},
		[facts.weekClosesAt, facts.programTimezone],
	)
	const warmupDeadline = formatDeadline(facts.warmupsCloseAt, facts.programTimezone)

	/** Where a week stands with review: draft, in_review, update_requested, approved or rejected. */
	const phaseStatusOf = useCallback(
		(weekId: number) => facts.phaseStatusByWeek[weekId] ?? "draft",
		[facts.phaseStatusByWeek],
	)

	// Handed in — in review, or decided. A week sent back for changes is open
	// again, because fixing it is the point of sending it back.
	const weekSubmitted = useCallback(
		(weekId: number) => {
			const status = facts.phaseStatusByWeek[weekId]
			return status === "in_review" || status === "approved" || status === "rejected"
		},
		[facts.phaseStatusByWeek],
	)

	const [ceremony, setCeremony] = useState<Ceremony>(seededCeremony)
	const [hydrated, setHydrated] = useState(false)
	const [openCheckpoint, setOpenCheckpoint] = useState<string | null>(null)
	const [tourStep, setTourStep] = useState(0)
	const [reducedMotion, setReducedMotion] = useState(false)

	useEffect(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
		const sync = () => setReducedMotion(mq.matches)
		sync()
		mq.addEventListener("change", sync)
		return () => mq.removeEventListener("change", sync)
	}, [])

	// Reading the persisted ceremony is exactly the external-system sync an effect
	// is for: it cannot run during render without breaking SSR hydration, since
	// the server has no localStorage and must render the seeded state.
	useEffect(() => {
		let next: Ceremony | null = null
		try {
			const raw = window.localStorage.getItem(KEY)
			if (raw) {
				const parsed = JSON.parse(raw) as Ceremony
				if (parsed && parsed.version === 4) next = { ...seededCeremony(), ...parsed }
			}
		} catch {
			/* storage unavailable — run from the seed */
		}
		// eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage
		if (next) setCeremony(next)
		setHydrated(true)
	}, [])

	useEffect(() => {
		if (!hydrated) return
		try {
			window.localStorage.setItem(KEY, JSON.stringify(ceremony))
		} catch {
			/* quota or private mode — the session still works, it just will not persist */
		}
	}, [ceremony, hydrated])

	// Someone who has already finished the first checkpoint must never be shown
	// the intro again, whatever a stale or cleared localStorage says. The server
	// is what knows, so it gets the final word — unless they asked for it back.
	// A replay plays the cinematic and the tab tour and goes nowhere near the
	// setup checkpoint: its answers are taken once, and the server refuses a
	// second set, so "aim" and "checkpoint" go straight on to the tour.
	//
	// Before week 1 opens, Get started is shut, so the intro goes from the
	// fly-through straight to the tab tour: "aim" (the spotlight on that
	// checkpoint) and "checkpoint" (its modal) have nothing to point at.
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
			setCeremony((c) => {
				// The tour plays once. Someone who took it while week 1 was shut
				// finishes Get started straight onto the trail, not into it again.
				const phase = next === "tour" && c.toured && !c.replaying ? "done" : next
				return {
					...c,
					phase,
					// Finishing or skipping ends the replay, so a later sign-in does not
					// start it again.
					replaying: phase === "done" ? false : c.replaying,
				}
			}),
		[],
	)

	const finishTour = useCallback(
		() => setCeremony((c) => ({ ...c, phase: "done", replaying: false, toured: true })),
		[],
	)

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
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ weekId }),
					})
					if (!res.ok) return null
					const { id } = (await res.json()) as { id: string }
					setFacts((f) => ({ ...f, projectIdByWeek: { ...f.projectIdByWeek, [weekId]: id } }))
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
	 * Naming a week's project — filling in the row its checkpoint made when it
	 * was opened (ensureProject). A second project for the same week is refused
	 * rather than queued behind the first, where nothing would ever read it.
	 */
	const addProject = useCallback(
		(p: Omit<Project, "id">) => {
			void (async () => {
				// Normally made when the checkpoint opened; made here if that request
				// had not landed yet, so a quick "Create project" still has a row.
				const id = await ensureProject(p.weekId)
				if (!id) return
				setFacts((f) =>
					f.projects.some((existing) => existing.weekId === p.weekId)
						? f
						: { ...f, projects: [...f.projects, { ...p, id }] },
				)
				await send(
					`/api/projects/${id}`,
					{
						title: p.name,
						description: p.description,
						requestedTier: p.tier,
						...(p.githubRepo ? { githubRepo: p.githubRepo } : {}),
						...(p.starterProjectId !== undefined ? { starterProjectId: p.starterProjectId } : {}),
					},
					"PATCH",
				)
			})().finally(() => router.refresh())
		},
		[ensureProject, router],
	)

	/**
	 * `requestedTier`, never `tier`.
	 *
	 * The assigned tier is a reviewer's decision at design approval, because it
	 * is parts money. This is the participant saying which one they are aiming
	 * at, and the API refuses to write anything else.
	 */
	const setProjectRepo = useCallback(
		async (id: string, url: string | null): Promise<string | null> => {
			let res: Response
			try {
				res = await fetch(`/api/projects/${id}`, {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ githubRepo: url }),
				})
			} catch {
				return "Could not reach the server. Try again."
			}
			if (!res.ok) {
				const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
				return err?.error?.message ?? "That did not save. Try again."
			}
			setFacts((f) => ({
				...f,
				projects: f.projects.map((p) => (p.id === id ? { ...p, githubRepo: url } : p)),
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
			const body = (await res.json().catch(() => null)) as {
				githubRepo?: string | null
				error?: { message?: string }
			} | null
			if (!res.ok) return body?.error?.message ?? "That did not save. Try again."
			const url = body?.githubRepo ?? null
			setFacts((f) => ({
				...f,
				projects: f.projects.map((p) => (p.id === id ? { ...p, githubRepo: url } : p)),
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
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...(patch.name !== undefined ? { title: patch.name } : {}),
						...(patch.description !== undefined ? { description: patch.description } : {}),
						...(patch.coverImageKey !== undefined ? { coverImageKey: patch.coverImageKey } : {}),
						...(patch.githubRepo !== undefined ? { githubRepo: patch.githubRepo } : {}),
						...(patch.tier !== undefined ? { requestedTier: patch.tier } : {}),
					}),
				})
			} catch {
				return "Could not reach the server. Try again."
			}
			if (!res.ok) {
				const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
				return err?.error?.message ?? "That did not save. Try again."
			}
			setFacts((f) => ({
				...f,
				projects: f.projects.map((p) =>
					p.id === id
						? {
								...p,
								...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
								...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
								...(patch.githubRepo !== undefined ? { githubRepo: patch.githubRepo } : {}),
								...(patch.tier !== undefined ? { tier: patch.tier } : {}),
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
			setFacts((f) => ({
				...f,
				projects: f.projects.map((p) => (p.id === id ? { ...p, tier } : p)),
			}))
			void send(`/api/projects/${id}`, { requestedTier: tier }, "PATCH").finally(() => router.refresh())
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
				return info ? { projectId: warmup[1], phase: info.phase === "build" ? "BUILD" : "DESIGN" } : null
			}
			const weekId = Number(/^w(\d+)-/.exec(checkpointId)?.[1])
			if (!Number.isInteger(weekId) || weekId < 0) return null
			const designWeek = weekId > DESIGN_WEEKS ? weekId - DESIGN_WEEKS : weekId
			const projectId = facts.projectIdByWeek[designWeek]
			if (!projectId) return null
			return { projectId, phase: weekId > DESIGN_WEEKS ? "BUILD" : "DESIGN" }
		},
		[facts.projectIdByWeek, facts.warmups],
	)

	const patchCheckpoint = useCallback(
		(id: string, patch: Partial<CheckpointState>) =>
			setFacts((f) => {
				const prev = { ...EMPTY, ...f.progress[id] }
				return {
					...f,
					progress: {
						...f.progress,
						// The first completion is the one that dates it. Redoing a
						// checkpoint should not move it up the project timeline past work
						// that came after it.
						[id]: { ...prev, ...patch, at: prev.at ?? Date.now(), done: true },
					},
				}
			}),
		[],
	)

	/**
	 * Mark a checkpoint done.
	 *
	 * Which write that means depends on the node, because the trail's nodes are
	 * derived from real records rather than stored as a list of ticks: a reel is
	 * a post, a submission is a submission, and the first checkpoint is the
	 * onboarding flow's own business.
	 */
	const complete = useCallback(
		(id: string, patch: Partial<CheckpointState> = {}) => {
			patchCheckpoint(id, patch)

			const route = routeOf(id)
			if (route && /-submit$/.test(id)) {
				void send(`/api/projects/${route.projectId}/submit`, { phase: route.phase }).finally(() => router.refresh())
				return
			}

			// Reels are posted by the reel modal, which has to upload the video
			// before there is anything to post; the first checkpoint is written by
			// the onboarding API as its steps are answered. Both arrive back through
			// the snapshot, so there is nothing to send here.
			router.refresh()
		},
		[patchCheckpoint, routeOf, router],
	)

	/**
	 * Post a reel against the node that asked for it.
	 *
	 * `checkpointKey` is what binds the post to the node, and it has to: the 10h
	 * and the 20h reel are both PROGRESS, so counting posts by kind would tick
	 * the 20h node the moment the 10h one landed.
	 */
	// Resolves to the new post's id — what a public link gets attached to — or
	// null if the post did not land. The node is patched first either way, and
	// the refresh puts the truth back if the write failed.
	const postReel = useCallback(
		async (id: string, caption: string, objectKey: string): Promise<string | null> => {
			patchCheckpoint(id, { caption, artefacts: 1 })
			const route = routeOf(id)
			try {
				const res = await fetch("/api/posts", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						// Three occasions, three kinds: the pitch at the start of a design
						// week, the ones that mark the hours, and the one that closes a
						// week inside Submit.
						kind: id.endsWith("-reel-idea") ? "IDEA" : id.endsWith("-reel-submission") ? "SUBMISSION" : "PROGRESS",
						caption,
						objectKey,
						checkpointKey: id,
						themeProjectId: route?.projectId ?? null,
					}),
				})
				if (!res.ok) return null
				// Re-recording an owed reel lifts the hold now rather than on the
				// refresh, so the map opens back up the moment it is posted.
				setFacts((f) => (f.owedReels.includes(id) ? { ...f, owedReels: f.owedReels.filter((k) => k !== id) } : f))
				const { post } = (await res.json()) as { post?: { id?: string } }
				return post?.id ?? null
			} catch {
				return null
			} finally {
				router.refresh()
			}
		},
		[patchCheckpoint, routeOf, router],
	)

	// Server first, like logSession: the submit route runs the repo checks and
	// can refuse, and a week shown as handed in that then quietly reopens on the
	// next refresh is worse than a sheet that says what is wrong.
	const submitPhase = useCallback(
		async (id: string, extra: { notes?: string; attachmentKeys?: string[] } = {}): Promise<string | null> => {
			const route = routeOf(id)
			if (!route) return "This week has no project to submit."
			let res: Response
			try {
				res = await fetch(`/api/projects/${route.projectId}/submit`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						phase: route.phase,
						...(extra.notes ? { notes: extra.notes } : {}),
						attachmentKeys: extra.attachmentKeys ?? [],
					}),
				})
			} catch {
				return "Could not reach the server. Nothing was submitted — try again."
			}
			if (!res.ok) {
				const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
				return err?.error?.message ?? "The week was not submitted. Try again."
			}
			patchCheckpoint(id, {})
			router.refresh()
			return null
		},
		[patchCheckpoint, routeOf, router],
	)

	/**
	 * Take a handed-in week back out of review, so it can be changed and handed
	 * in again. Only a week still waiting for a reviewer can be — the server
	 * refuses once a decision is made, or while a reviewer has it open.
	 *
	 * A checkpoint id resolves to its project through `projectIdByWeek`, which
	 * works for the trail. A warm-up project has no checkpoint: several of them
	 * share week 0, so a week id cannot say which one, and the caller names the
	 * project and phase instead.
	 */
	const unsubmitPhase = useCallback(
		async (target: string | { projectId: string; phase: "DESIGN" | "BUILD" }): Promise<string | null> => {
			const fromCheckpoint = typeof target === "string"
			const route = fromCheckpoint ? routeOf(target) : { projectId: target.projectId, phase: target.phase }
			if (!route) return "This week has no project to unsubmit."
			let res: Response
			try {
				res = await fetch(`/api/projects/${route.projectId}/unsubmit`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ phase: route.phase }),
				})
			} catch {
				return "Could not reach the server. Nothing changed — try again."
			}
			if (!res.ok) {
				const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
				return err?.error?.message ?? "The week was not unsubmitted. Try again."
			}
			if (fromCheckpoint) {
				const weekId = Number(/^w(\d+)-/.exec(target)?.[1])
				if (Number.isInteger(weekId)) {
					setFacts((f) => ({
						...f,
						phaseStatusByWeek: { ...f.phaseStatusByWeek, [weekId]: "draft" },
						progress: { ...f.progress, [target]: { ...EMPTY, ...f.progress[target], done: false } },
					}))
				}
			}
			router.refresh()
			return null
		},
		[routeOf, router],
	)

	const setDoomscroller = useCallback(
		(doomscrollerOpen: boolean) => setCeremony((c) => ({ ...c, doomscrollerOpen })),
		[],
	)

	const setGoal = useCallback(
		(goalId: string) => {
			setFacts((f) => ({ ...f, goalId }))
			void send("/api/me", { printerGoalId: goalId }, "PATCH").finally(() => router.refresh())
		},
		[router],
	)

	/**
	 * Replay the first run.
	 *
	 * Ceremony only. It cannot un-log a session or un-post a reel, and pretending
	 * otherwise would be the more surprising behaviour: the trail comes back
	 * exactly as it was, with the intro playing over it.
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
	 * The full redo, for admins checking the flow. The server clears the answers
	 * first; only then is the ceremony reseeded, and without `replaying`, so once
	 * the refreshed snapshot says onboarding is not done the intro runs on into
	 * the setup checkpoint as it would for someone new.
	 */
	const redoOnboarding = useCallback(async (): Promise<string | null> => {
		let res: Response
		try {
			res = await fetch("/api/onboarding/reset", { method: "POST" })
		} catch {
			return "Could not reach the server. Nothing was reset, so try again."
		}
		if (!res.ok) {
			const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
			return payload?.error?.message ?? `Could not reset onboarding (${res.status})`
		}
		try {
			window.localStorage.removeItem(KEY)
		} catch {
			/* nothing to clear */
		}
		setFacts((f) => ({ ...f, onboardingDone: false }))
		setCeremony(seededCeremony())
		setTourStep(0)
		setOpenCheckpoint(null)
		router.refresh()
		return null
	}, [router])

	const save = facts

	// Saves written before a field existed would otherwise hand back a record
	// with holes in it, so every read is filled out from EMPTY.
	const stateOf = useCallback((id: string): CheckpointState => ({ ...EMPTY, ...save.progress[id] }), [save.progress])

	// A build week inherits the tier of the design week it is building. A week
	// nobody has started yet borrows the last tier picked, so the trail shows a
	// believable shape instead of lurching when the project is finally created.
	const tierForWeek = useCallback(
		(weekId: number): 1 | 2 | 3 => {
			const designWeek = weekId > 5 ? weekId - 5 : weekId
			const own = save.projects.find((p) => p.weekId === designWeek)
			if (own) return own.tier
			return save.projects[save.projects.length - 1]?.tier ?? recommendedTier(save.experience)
		},
		[save.projects, save.experience],
	)

	// The printer you are saving for sets how many hours a week you need to bank,
	// and that number is the same on every tier — the tier only decides how many
	// funded hours sit underneath it.
	const goal = printerById(save.goalId)

	const weeks = useMemo<Week[]>(
		() =>
			WEEK_META.map((meta) => {
				const tierId = tierForWeek(meta.id)
				const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[0]
				const build = meta.phase === "build"
				// Column 5 is the tier-1 week and is already floored to a flat 10 hours,
				// so every other tier is that plus the extra hours its grant funds.
				const target = build ? BUILD_HOURS : weekAsk(goal.hoursPerWeek, tier.fundingHours)
				// The same ask at the cheapest machine's pace: the least a week can be
				// worth and still leave a printer at the end of the season.
				const submitHours = build ? BUILD_HOURS : submitFloorFor(tier.fundingHours)
				// The trail is as long as the work was: every finished entry is a node,
				// and one more waits at the end for the entry about to be written. The
				// minutes come along because reels are placed where the clock crossed.
				const written: number[] = []
				for (;;) {
					const done = save.progress[`w${meta.id}-entry-${written.length + 1}`]
					if (!done?.done) break
					written.push(done.minutes)
				}
				return {
					...meta,
					tier: tierId,
					fundingHours: build ? BUILD_HOURS : tier.fundingHours,
					// Build-week hours all bank; the grant paid for the design week.
					bankedFrom: build ? 0 : tier.fundingHours,
					targetHours: target,
					submitHours,
					checkpoints: checkpointsFor(
						meta,
						written,
						(cid) => save.progress[cid]?.done ?? false,
						submitHours,
						// Onboarding made week one's project and it has since been
						// deleted: `projects` only lists live, named ones.
						meta.id === 1 &&
							(save.progress[ONBOARDING_CHECKPOINT_ID]?.done ?? false) &&
							!save.projects.some((p) => p.weekId === 1),
					),
				}
			}),
		[tierForWeek, goal, save.progress, save.projects],
	)

	// Each warm-up, as a week of its own that the trail never draws.
	const warmupWeeks = useMemo<Week[]>(
		() =>
			save.projects.flatMap((project) => {
				const info = facts.warmups[project.id]
				if (project.weekId !== WARMUP_WEEK_ID || !info) return []
				return [warmupWeek(project, info.phase === "build", (id) => save.progress[id]?.done ?? false)]
			}),
		[save.projects, facts.warmups, save.progress],
	)

	// Every checkpoint a modal can open, the warm-ups' included. The trail
	// itself draws `weeks` only.
	const allCheckpoints = useMemo(() => [...weeks, ...warmupWeeks].flatMap((w) => w.checkpoints), [weeks, warmupWeeks])

	const warmupWeekOf = useCallback(
		(projectId: string) => warmupWeeks.find((w) => w.projectId === projectId) ?? null,
		[warmupWeeks],
	)

	/**
	 * One saved journal: the entry, the time claimed, and the evidence for it.
	 *
	 * Note what this does NOT do any more: credit coins. Hours are paid for when
	 * a reviewer approves the phase, not when they are claimed — otherwise the
	 * currency is self-issued, and a week could be spent in the shop before
	 * anyone had looked at it. The trail still moves immediately, because the
	 * node is the entry rather than the payment.
	 */
	const logSession = useCallback(
		async (
			id: string,
			minutes: number,
			body: string,
			evidence: Pick<SessionLog, "clips"> = { clips: [] },
		): Promise<string | null> => {
			// Server first, unlike the other writes here. An entry's timelapses are
			// checked against Lapse, and a refusal is something the maker has to
			// fix in the sheet — patching the trail first would show a node done
			// for an entry that was never saved.
			const route = routeOf(id)
			if (route) {
				let res: Response
				try {
					res = await fetch(`/api/projects/${route.projectId}/sessions`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							phase: route.phase,
							// The journal's first line stands in for a title. The form asks
							// for one piece of writing, and inventing a second field to
							// satisfy the column would put a box on screen that exists only
							// because of the schema.
							title: body.trim().split("\n")[0]?.slice(0, 200) || "Work session",
							content: body,
							hoursClaimed: Math.round((minutes / 60) * 100) / 100,
							timelapses: evidence.clips.map((lapseId) => ({ lapseId })),
						}),
					})
				} catch {
					return "Could not reach the server. Your entry is still here — try again."
				}
				if (!res.ok) {
					const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
					return err?.error?.message ?? "The entry was not saved. Try again."
				}
			}

			setFacts((f) => {
				const prev = { ...EMPTY, ...f.progress[id] }
				const entry: SessionLog = {
					id: `${id}-s${prev.log.length + 1}`,
					minutes,
					body,
					at: Date.now(),
					...evidence,
				}
				return {
					...f,
					progress: {
						...f.progress,
						[id]: {
							...prev,
							done: true,
							at: prev.at ?? Date.now(),
							minutes: prev.minutes + minutes,
							log: [...prev.log, entry],
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
	 * Change a finished entry's words and hours. The node stays where it is —
	 * this is the same session, corrected, not another one — and its timelapses
	 * stay attached, because the server does not re-home evidence.
	 *
	 * Server first, like logSession: the server can refuse (an entry a reviewer
	 * has already put hours on, a week in review or passed), and an edit shown as
	 * saved that quietly reverts on the next refresh is worse than a sheet that
	 * says why it did not take.
	 */
	const editSession = useCallback(
		async (id: string, minutes: number, body: string): Promise<string | null> => {
			const route = routeOf(id)
			const entry = facts.progress[id]?.log[0]
			if (!route || !entry) return "That entry could not be found. Refresh and try again."
			let res: Response
			try {
				res = await fetch(`/api/projects/${route.projectId}/sessions/${entry.id}`, {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						title: body.trim().split("\n")[0]?.slice(0, 200) || "Work session",
						content: body,
						hoursClaimed: Math.round((minutes / 60) * 100) / 100,
					}),
				})
			} catch {
				return "Could not reach the server. Your changes are still here — try again."
			}
			if (!res.ok) {
				const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
				return err?.error?.message ?? "The entry was not saved. Try again."
			}
			setFacts((f) => {
				const prev = { ...EMPTY, ...f.progress[id] }
				return {
					...f,
					progress: {
						...f.progress,
						[id]: {
							...prev,
							minutes,
							log: prev.log.map((l, i) => (i === 0 ? { ...l, minutes, body } : l)),
						},
					},
				}
			})
			router.refresh()
			return null
		},
		[routeOf, facts.progress, router],
	)

	const weekOf = useCallback(
		(weekId: number): Week => {
			const week = weeks.find((w) => w.id === weekId) ?? weeks[0]
			// The curriculum is a compile-time constant with ten weeks in it, so an
			// empty list is a broken build rather than a state to render around.
			if (!week) throw new Error("The curriculum has no weeks in it")
			return week
		},
		[weeks],
	)

	/**
	 * What a week is worth, for every gate that asks.
	 *
	 * Journalled entries plus whatever arrived another way — Hackatime link time,
	 * and any hours a reviewer adjusted. The two are added here rather than
	 * folded into the entries upstream because reels are placed where the JOURNAL
	 * crossed a reel's mark: fold Hackatime in and a progress reel lands on a node
	 * the participant never wrote.
	 */
	const weekHours = useCallback(
		(weekId: number) => {
			const week = weeks.find((w) => w.id === weekId)
			if (!week) return 0
			const mins = week.checkpoints.reduce((n, c) => n + (facts.progress[c.id]?.minutes ?? 0), 0)
			return mins / 60 + (facts.offBookHours[weekId] ?? 0)
		},
		[weeks, facts.progress, facts.offBookHours],
	)

	// The same questions asked of a week object, so a sheet can serve a warm-up
	// (which has no week number of its own) as readily as a season week.
	const weekOfCheckpoint = useCallback(
		(checkpoint: Checkpoint): Week =>
			warmupWeeks.find((w) => w.checkpoints.some((c) => c.id === checkpoint.id)) ?? weekOf(checkpoint.weekId),
		[warmupWeeks, weekOf],
	)
	const hoursOf = useCallback(
		(week: Week): number => {
			if (!week.projectId) return weekHours(week.id)
			const mins = week.checkpoints.reduce((n, c) => n + (facts.progress[c.id]?.minutes ?? 0), 0)
			return mins / 60 + (facts.warmups[week.projectId]?.offBookHours ?? 0)
		},
		[weekHours, facts.progress, facts.warmups],
	)
	const passedOf = useCallback(
		(week: Week): boolean => {
			if (!week.projectId) return weekPassed(week.id)
			const closesAt = facts.warmups[week.projectId]?.closesAt
			return closesAt !== undefined && now >= closesAt
		},
		[weekPassed, facts.warmups, now],
	)
	const deadlineOf = useCallback(
		(week: Week): string | null => {
			if (!week.projectId) return weekDeadline(week.id)
			const closesAt = facts.warmups[week.projectId]?.closesAt
			return closesAt === undefined ? null : formatDeadline(closesAt, facts.programTimezone)
		},
		[weekDeadline, facts.warmups, facts.programTimezone],
	)
	const statusOf = useCallback(
		(week: Week): string => {
			if (!week.projectId) return phaseStatusOf(week.id)
			const project = save.projects.find((p) => p.id === week.projectId)
			return (week.phase === "build" ? project?.buildStatus : project?.designStatus) ?? "draft"
		},
		[phaseStatusOf, save.projects],
	)

	/**
	 * What the unreviewed weeks are on course to bank, at the ledger's own rule:
	 * every hour past the week's funded block (all of a build week's) at
	 * COINS_PER_HOUR. Approved weeks are skipped because their coins are already
	 * in the fund, rejected ones because they will never mint. It is a
	 * projection — a reviewer can still adjust the hours — which is why it only
	 * feeds the pace warning and never the balance anyone can spend.
	 */
	const pendingCoins = useCallback(
		(weekId: number) =>
			weeks
				.filter((w) => w.id <= weekId)
				.reduce((n, w) => {
					const status = facts.phaseStatusByWeek[w.id]
					if (status === "approved" || status === "rejected") return n
					return n + Math.max(0, weekHours(w.id) - w.bankedFrom) * COINS_PER_HOUR
				}, 0),
		[weeks, facts.phaseStatusByWeek, weekHours],
	)

	/**
	 * Whether a checkpoint is shut because its week ran out of time.
	 *
	 * Every node on a passed week is, done or not, with two exceptions: the
	 * Submit that still owes the week's hand-in, and a setup nobody has done
	 * yet — a late joiner still has to come in through the front door. A Submit
	 * with nothing logged behind it passes with the rest, because the server
	 * refuses an empty hand-in and there is nothing left to do about that.
	 */
	const isPassed = useCallback(
		(id: string): boolean => {
			const week = [...weeks, ...warmupWeeks].find((w) => w.checkpoints.some((c) => c.id === id))
			const self = week?.checkpoints.find((c) => c.id === id)
			if (!week || !self || !passedOf(week)) return false
			const done = save.progress[id]?.done ?? false
			if (self.kind === "onboarding" && !done) return false
			if (self.kind === "submit" && !done && hoursOf(week) > 0) return false
			return true
		},
		[weeks, warmupWeeks, passedOf, save.progress, hoursOf],
	)

	/**
	 * Whether a checkpoint waits on a deleted reel.
	 *
	 * Deleting the last reel on a checkpoint reopens it, and until it is posted
	 * again every other checkpoint is held — done ones included, so the map
	 * shows plainly that one thing is owed. The server holds the same line
	 * (lib/reel-gate), and only ever reports a reel owed while its week can
	 * still take one, so the hold always has a way out.
	 */
	const isHeld = useCallback(
		(id: string): boolean => facts.owedReels.length > 0 && !facts.owedReels.includes(id),
		[facts.owedReels],
	)

	/**
	 * Whether a week still stands between the trail and the week after it. A
	 * week holds the next one shut until it is handed in — except a week that
	 * passed with nothing in it, which can never be handed in and would
	 * otherwise dead-end the rest of the season.
	 */
	const owesSubmit = useCallback(
		(week: Week): boolean => {
			const submit = week.checkpoints.find((c) => c.kind === "submit")
			if (!submit || (save.progress[submit.id]?.done ?? false)) return false
			return !(weekPassed(week.id) && weekHours(week.id) === 0)
		},
		[save.progress, weekPassed, weekHours],
	)

	/**
	 * Four rules, and only four break the sequence:
	 *  - a week that has passed is shut, all but the Submit it still owes —
	 *    which opens whatever the hours say, since no more can be logged;
	 *  - anything on the clock (the milestone reels, and Submit itself) opens on
	 *    the week's hours, so a half-written entry never traps you and the choice
	 *    to wrap up is always live.
	 * Everything else unlocks in order, as it always has.
	 */
	const isUnlocked = useCallback(
		(id: string): boolean => {
			// The owed reel is the way out, so it opens whatever else is true —
			// including a week that has since closed while this tab held a stale
			// snapshot. Checking `isPassed` first dead-mapped the whole trail until
			// the page was reloaded and the server stopped reporting the debt.
			if (facts.owedReels.includes(id)) return true
			if (isPassed(id)) return false
			if (isHeld(id)) return false
			const done = (c: Checkpoint) => save.progress[c.id]?.done ?? false
			const wi = weeks.findIndex((w) => w.checkpoints.some((c) => c.id === id))
			if (wi === -1) return false
			// Nothing on a week opens before its Monday, Get started included.
			const opening = weeks[wi]
			if (opening && !weekStarted(opening.id)) return false

			const prev = weeks[wi - 1]
			if (prev && owesSubmit(prev)) return false

			const week = weeks[wi]
			const list = week?.checkpoints ?? []
			const i = list.findIndex((c) => c.id === id)
			const self = list[i]
			if (!week || !self) return false

			if (self.kind === "submit" && weekPassed(week.id)) return true

			if (self.atHours !== undefined) {
				const hours = weekHours(week.id)
				// Unwritten entries never block a milestone — the clock does. Neither
				// does a milestone that is not due yet: the reel waiting at 30h cannot
				// hold up a Submit that opened at 23.76h.
				//
				// "Keep working" rides this rule too, at atHours 0. A reel that has
				// come due is the cadence asking to be paid before the week runs on;
				// letting the fork's other arm open around it would make every
				// progress reel skippable forever.
				const gates = list.slice(0, i).filter((c) => c.kind !== "journal" && (c.atHours ?? 0) <= hours)
				return gates.every(done) && hours >= self.atHours
			}

			return list.slice(0, i).every(done)
		},
		[isPassed, isHeld, facts.owedReels, owesSubmit, weekPassed, weekStarted, weeks, save.progress, weekHours],
	)

	/**
	 * Why a checkpoint is shut, in the maker's terms. Null when it is open.
	 *
	 * It walks the same three rules as isUnlocked, in the same order, and lives
	 * next to it so the two cannot drift: a trail that says one thing and does
	 * another is worse than a trail that says nothing. Each branch names the one
	 * thing standing in the way rather than listing everything outstanding —
	 * only the first is actionable anyway.
	 */
	const lockReason = useCallback(
		(id: string): string | null => {
			// Titles are node names, so they keep their capital. The verb follows
			// the kind: you post a reel, you finish everything else.
			const firstFinish = (c: Checkpoint) => (c.kind === "reel" ? `Post ${c.title} first.` : `Finish ${c.title} first.`)

			if (isUnlocked(id)) return null
			if (isPassed(id)) return PASSED_REASON
			if (isHeld(id)) {
				const owedId = facts.owedReels[0]
				const owed = weeks.flatMap((w) => w.checkpoints).find((c) => c.id === owedId)
				return owed ? `Re-record ${owed.title} first. You deleted it.` : "Re-record the reel you deleted first."
			}

			const done = (c: Checkpoint) => save.progress[c.id]?.done ?? false
			const wi = weeks.findIndex((w) => w.checkpoints.some((c) => c.id === id))
			if (wi === -1) return null

			const opening = weeks[wi]
			if (opening && !weekStarted(opening.id)) {
				const day = weekOpensOn(opening.id)
				return day ? `Week ${opening.id} opens ${day}.` : `Week ${opening.id} has not opened yet.`
			}

			const prev = weeks[wi - 1]
			if (prev && owesSubmit(prev)) return `Submit week ${prev.id} first.`

			const week = weeks[wi]
			const list = week?.checkpoints ?? []
			const i = list.findIndex((c) => c.id === id)
			const self = list[i]
			if (!week || !self) return null

			if (self.atHours !== undefined) {
				const hours = weekHours(week.id)
				const owed = list.slice(0, i).find((c) => c.kind !== "journal" && (c.atHours ?? 0) <= hours && !done(c))
				if (owed) return firstFinish(owed)
				const toGo = Math.round((self.atHours - hours) * 100) / 100
				return `Opens at ${self.atHours}h logged this week — ${toGo}h to go.`
			}

			const blocker = list.slice(0, i).find((c) => !done(c))
			return blocker ? firstFinish(blocker) : null
		},
		[
			isUnlocked,
			isPassed,
			isHeld,
			facts.owedReels,
			owesSubmit,
			weekStarted,
			weekOpensOn,
			weeks,
			save.progress,
			weekHours,
		],
	)

	const currentCheckpointId = useMemo(() => {
		const next = allCheckpoints.find((c) => !(save.progress[c.id]?.done ?? false) && isUnlocked(c.id))
		return next?.id ?? null
	}, [allCheckpoints, save.progress, isUnlocked])

	const value: Ctx = {
		...facts,
		phase,
		doomscrollerOpen: ceremony.doomscrollerOpen,
		// A printer can be paid for out of either pot, so the goal tracker reads
		// the total. Everything else in the shop takes `coins` alone.
		printerFund: facts.coins + facts.bankedCoins,
		hydrated,
		openCheckpoint,
		tourStep,
		reducedMotion,
		setPhase,
		finishTour,
		setTourStep,
		addProject,
		ensureProject,
		setProjectTier,
		setProjectRepo,
		linkSyncRepoToProject,
		updateProject,
		complete,
		postReel,
		submitPhase,
		logSession,
		editSession,
		stateOf,
		isUnlocked,
		isPassed,
		isHeld,
		weekPassed,
		weekStarted,
		weekOpensOn,
		weekDeadline,
		warmupDeadline,
		weekSubmitted,
		phaseStatusOf,
		unsubmitPhase,
		lockReason,
		currentCheckpointId,
		setOpenCheckpoint,
		setDoomscroller,
		setGoal,
		reset,
		redoOnboarding,
		weeks,
		warmupWeekOf,
		weekOfCheckpoint,
		hoursOf,
		passedOf,
		statusOf,
		deadlineOf,
		allCheckpoints,
		weekOf,
		weekHours,
		pendingCoins,
	}

	return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Ctx {
	const ctx = useContext(StoreContext)
	if (!ctx) throw new Error("useStore must be used inside StoreProvider")
	return ctx
}

/** Recommended tier from the onboarding experience answer. */
export function recommendedTier(e: Experience | null): 1 | 2 | 3 {
	if (e === "lots") return 3
	if (e === "some") return 2
	return 1
}
