"use client"

import type { useRouter } from "next/navigation"
import { type Dispatch, type SetStateAction, useCallback } from "react"
import { z } from "zod"
import { errorMessage } from "./api-error"
import { DESIGN_WEEKS } from "./config/program"
import type { ParticipantGoal } from "./enums"
import { round2 } from "./money"
import type { StoreSnapshot } from "./queries/store"
import { DEFAULT_SESSION_TITLE } from "./schemas/session"
import type { PostReelResult } from "./store"
import { type CheckpointState, EMPTY } from "./trail"
import type { SessionLog } from "./types"

/** The post body this module reads back from the API. Parsed, so a wrong shape cannot reach the trail. */
const PostedReelBody = z.object({ post: z.object({ id: z.string() }).optional() })

/** The extra statements a hand-in can carry. */
export interface SubmitExtras {
	attachmentKeys?: string[]
	fundingDeclined?: boolean
	noMicrocontroller?: boolean
	notes?: string
	partialFundingAccepted?: boolean
}

/** A phase to take back out of review: a checkpoint id, or a project and phase for a warm-up with no checkpoint. */
export type UnsubmitTarget = string | { projectId: string; phase: "DESIGN" | "BUILD" }

/**
 * Post JSON and reload the snapshot.
 *
 * Errors are swallowed on purpose. Every caller has already patched local state optimistically, and the `router.refresh()` in the `finally` reloads the server's version either way – so a failed write corrects itself on screen instead of leaving the trail showing something that did not happen.
 */
export async function send(
	path: string,
	body: unknown,
	method: "DELETE" | "PATCH" | "POST" = "POST",
): Promise<boolean> {
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

interface StoreWritesOptions {
	facts: StoreSnapshot
	router: ReturnType<typeof useRouter>
	setFacts: Dispatch<SetStateAction<StoreSnapshot>>
}

/** The provider's mutation hook for checkpoints and journal entries, kept apart from its ceremony and derivation. */
interface StoreWrites {
	complete(id: string, patch?: Partial<CheckpointState>): void
	editSession(id: string, minutes: number, body: string, evidence?: Pick<SessionLog, "clips">): Promise<string | null>
	finishOnboarding(): void
	logSession(id: string, minutes: number, body: string, evidence?: Pick<SessionLog, "clips">): Promise<string | null>
	postReel(id: string, caption: string, objectKey: string): Promise<PostReelResult>
	setParticipantGoal(goal: ParticipantGoal, printerGoalId?: string): Promise<string | null>
	submitPhase(id: string, extra?: SubmitExtras): Promise<string | null>
	unsubmitPhase(target: UnsubmitTarget): Promise<string | null>
}

/**
 * Every write a checkpoint or journal entry can make, from one place.
 *
 * Each mutation posts to the API and then asks Next to re-render the layout, which reloads the snapshot. Several also patch local state first, because a round trip to Postgres between clicking a node and seeing it fill is long enough to feel broken – and if the request fails the refresh puts the truth back.
 */
export function useStoreWrites({ facts, router, setFacts }: StoreWritesOptions): StoreWrites {
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
		[setFacts],
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
		[patchCheckpoint, routeOf, router, setFacts],
	)

	// Server first, like logSession: the submit route runs the repo checks and can refuse, and a week shown as handed in that then quietly reopens on the next refresh is worse than a sheet that says what is wrong.
	const submitPhase = useCallback(
		async (id: string, extra: SubmitExtras = {}): Promise<string | null> => {
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
		async (target: UnsubmitTarget): Promise<string | null> => {
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
		[routeOf, router, setFacts],
	)

	/**
	 * The first checkpoint answered its last question.
	 *
	 * Patched here rather than left to the refresh that follows, because the gate that holds the goal prompt open is `onboardingDone && participantGoal === null`. Waiting for the round-trip would put the tab tour's spotlight on screen for the length of the request and then cover it with the prompt. The API has already confirmed this, so it is a fact and not a guess.
	 */
	const finishOnboarding = useCallback(() => {
		setFacts(f => ({ ...f, onboardingDone: true }))
	}, [setFacts])

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
		[router, setFacts],
	)

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
		[routeOf, router, setFacts],
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
		[routeOf, facts.progress, router, setFacts],
	)

	return {
		complete,
		editSession,
		finishOnboarding,
		logSession,
		postReel,
		setParticipantGoal,
		submitPhase,
		unsubmitPhase,
	}
}
