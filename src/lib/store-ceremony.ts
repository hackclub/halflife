"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"
import { readStored, useHydrated, useMediaQuery, useStoredValue, writeStored } from "./browser-state"
import { setFreestylePreview } from "./config/freestyle"

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

/** The saved ceremony, parsed, so a stale or hand-edited localStorage row cannot reach the trail as a wrong shape. */
const CeremonySave = z.object({
	doomscrollerOpen: z.boolean().optional(),
	phase: z.enum(["cinematic", "aim", "checkpoint", "tour", "done"]).optional(),
	replaying: z.boolean().optional(),
	toured: z.boolean().optional(),
	version: z.literal(4),
})

/**
 * The admin lock bypass. Kept apart from the ceremony so "Replay the intro", which clears that, leaves it alone.
 */
const BYPASS_KEY = "halflife.bypass-locks"

/** The admin freestyle preview, kept on the same terms as the lock bypass. */
const FREESTYLE_PREVIEW_KEY = "halflife.preview-freestyle"

function seededCeremony(): Ceremony {
	return { doomscrollerOpen: true, phase: "cinematic", version: 4 }
}

/** The ceremony as saved, or the seed when nothing usable is saved. */
function parseCeremony(raw: string | null): Ceremony {
	const seed = seededCeremony()
	if (!raw) return seed
	try {
		const parsed = CeremonySave.safeParse(JSON.parse(raw))
		if (!parsed.success) return seed
		return {
			doomscrollerOpen: parsed.data.doomscrollerOpen ?? seed.doomscrollerOpen,
			phase: parsed.data.phase ?? seed.phase,
			replaying: parsed.data.replaying ?? seed.replaying,
			toured: parsed.data.toured ?? seed.toured,
			version: 4,
		}
	} catch {
		return seed
	}
}

/** Read the saved ceremony, change it, and save the result. Reads the store fresh, so a change made elsewhere is never overwritten by a stale copy. */
function updateCeremony(update: (c: Ceremony) => Ceremony) {
	writeStored(KEY, JSON.stringify(update(parseCeremony(readStored(KEY)))))
}

export interface StoreCeremony {
	bypassCheckpoint(id: string): void
	/** Admins only: every checkpoint on the trail opens, whatever its order, hours or dates say. Always false for anyone else. */
	bypassLocks: boolean
	doomscrollerOpen: boolean
	/** End the tab tour, finished or skipped, and remember it was seen. */
	finishTour(): void
	hydrated: boolean
	/** Whether an admin has opened this one checkpoint past its lock. */
	isBypassed(id: string): boolean
	phase: IntroPhase
	/** Admins only: week 5's participant copy as it reads from midnight on its first day, shown now. */
	previewFreestyle: boolean
	reducedMotion: boolean
	/** Reseed the ceremony for a full redo, without the replay flag. */
	reseedCeremony(): void
	/** Replay the first run. Ceremony only; it cannot un-log a session or un-post a reel. */
	resetCeremony(): void
	setBypassLocks(on: boolean): void
	setDoomscroller(open: boolean): void
	setPhase(p: IntroPhase): void
	setPreviewFreestyle(on: boolean): void
}

/**
 * The provider's browser-owned state: the intro, the tour, the admin bypasses and reduced motion.
 *
 * Facts stay in the store; this hook only reads the two that decide what the ceremony is allowed to show, and reports a freestyle change so the trail can be derived again with the preview's copy.
 */
export function useStoreCeremony({
	isAdmin,
	onboardingDone,
	onFreestylePreviewChange,
	weekOneStarted,
}: {
	isAdmin: boolean
	onboardingDone: boolean
	onFreestylePreviewChange(): void
	weekOneStarted: boolean
}): StoreCeremony {
	// The saved ceremony and admin flags come from the store, so the server draws the seed and the client reads the saved values straight after hydration.
	const ceremonyRaw = useStoredValue(KEY)
	const ceremony = useMemo(() => parseCeremony(ceremonyRaw), [ceremonyRaw])
	const hydrated = useHydrated()
	const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)")
	const bypassing = useStoredValue(BYPASS_KEY) === "1"
	const previewingFreestyle = useStoredValue(FREESTYLE_PREVIEW_KEY) === "1"
	// Single checkpoints an admin opened past their locks. Held in memory only: it is for checking one node, not a setting to come back to.
	const [bypassed, setBypassed] = useState<string[]>([])

	const setBypassLocks = useCallback((on: boolean) => {
		writeStored(BYPASS_KEY, on ? "1" : null)
	}, [])
	// Read by role, not by storage alone: a flag left behind on a shared browser, or by an admin since demoted, opens nothing.
	const bypassLocks = isAdmin && bypassing

	const setPreviewFreestyle = useCallback((on: boolean) => {
		writeStored(FREESTYLE_PREVIEW_KEY, on ? "1" : null)
	}, [])
	// By role as well, like the bypass.
	const previewFreestyle = isAdmin && previewingFreestyle
	const appliedFreestylePreview = useRef(false)
	useEffect(() => {
		if (appliedFreestylePreview.current === previewFreestyle) return
		appliedFreestylePreview.current = previewFreestyle
		setFreestylePreview(previewFreestyle)
		// The weeks are derived from the clock, so moving it on is what has them read week 5's copy again with the flag in place.
		onFreestylePreviewChange()
	}, [previewFreestyle, onFreestylePreviewChange])

	const bypassCheckpoint = useCallback(
		(id: string) => setBypassed(list => (list.includes(id) ? list : [...list, id])),
		[],
	)

	// Someone who has already finished the first checkpoint must never be shown the intro again, whatever a stale or cleared localStorage says. The server is what knows, so it gets the final word – unless they asked for it back. A replay plays the cinematic and the tab tour and goes nowhere near the setup checkpoint: its answers are taken once, and the server refuses a second set, so "aim" and "checkpoint" go straight on to the tour.
	//
	// Before week 1 opens, Get started is shut, so the intro goes from the fly-through straight to the tab tour: "aim" (the spotlight on that checkpoint) and "checkpoint" (its modal) have nothing to point at.
	const phase: IntroPhase = onboardingDone
		? ceremony.replaying
			? ceremony.phase === "aim" || ceremony.phase === "checkpoint"
				? "tour"
				: ceremony.phase
			: ceremony.phase === "tour"
				? "tour"
				: "done"
		: !weekOneStarted && (ceremony.phase === "aim" || ceremony.phase === "checkpoint")
			? ceremony.toured
				? "done"
				: "tour"
			: ceremony.phase

	const setPhase = useCallback(
		(next: IntroPhase) =>
			updateCeremony(c => {
				// The tour plays once. Someone who took it while week 1 was shut finishes Get started straight onto the trail, not into it again.
				const nextPhase = next === "tour" && c.toured && !c.replaying ? "done" : next
				return {
					...c,
					phase: nextPhase,
					// Finishing or skipping ends the replay, so a later sign-in does not start it again.
					replaying: phase === "done" ? false : c.replaying,
				}
			}),
		[phase],
	)

	const finishTour = useCallback(
		() => updateCeremony(c => ({ ...c, phase: "done", replaying: false, toured: true })),
		[],
	)

	const setDoomscroller = useCallback(
		(doomscrollerOpen: boolean) => updateCeremony(c => ({ ...c, doomscrollerOpen })),
		[],
	)

	/** Replay the first run. Ceremony only; it cannot un-log a session or un-post a reel. */
	const resetCeremony = useCallback(() => {
		updateCeremony(() => ({ ...seededCeremony(), replaying: true }))
	}, [])

	/** Reseed for the admin redo, without the replay flag, so the intro runs on into setup as it would for someone new. */
	const reseedCeremony = useCallback(() => {
		writeStored(KEY, null)
	}, [])

	const isBypassed = useCallback((id: string) => bypassed.includes(id), [bypassed])

	// One object for the whole run of a render, so the trail's store can depend on it without rebuilding everything it hands out. Without this, every member below was a new reference each render and the store's own memo never held.
	return useMemo(
		() => ({
			bypassCheckpoint,
			bypassLocks,
			doomscrollerOpen: ceremony.doomscrollerOpen,
			finishTour,
			hydrated,
			isBypassed,
			phase,
			previewFreestyle,
			reducedMotion,
			reseedCeremony,
			resetCeremony,
			setBypassLocks,
			setDoomscroller,
			setPhase,
			setPreviewFreestyle,
		}),
		[
			bypassCheckpoint,
			bypassLocks,
			ceremony.doomscrollerOpen,
			finishTour,
			hydrated,
			isBypassed,
			phase,
			previewFreestyle,
			reducedMotion,
			reseedCeremony,
			resetCeremony,
			setBypassLocks,
			setDoomscroller,
			setPhase,
			setPreviewFreestyle,
		],
	)
}
