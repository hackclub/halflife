"use client"
import { useCallback, useMemo } from "react"
import { readStored, useStoredValue, writeStored } from "@/lib/browser-state"
import { isRecord } from "@/lib/unknown"

/**
 * How this viewer likes the Doomscroller: sound, speed, whether it moves on by itself, and whether the comments stand open beside the reel.
 *
 * Per browser, in localStorage, the way the rest of the ceremony is kept: nobody else ever needs to read it, and a new laptop starting from the defaults is no loss. Every read and write is guarded – a private window or blocked storage just means the defaults, every visit.
 */

export const RATES = [1, 1.5, 2, 0.5] as const

export interface PlayerPrefs {
	autoScroll: boolean
	comments: boolean
	muted: boolean
	rate: (typeof RATES)[number]
}

const KEY = "halflife.player.v1"
const DEFAULTS: PlayerPrefs = { autoScroll: false, comments: true, muted: false, rate: 1 }

/** The saved prefs, with the defaults for anything missing, malformed or unreadable. */
function parsePrefs(raw: string | null): PlayerPrefs {
	if (!raw) return DEFAULTS
	try {
		const saved: unknown = JSON.parse(raw)
		if (!isRecord(saved)) return DEFAULTS
		return {
			autoScroll: typeof saved.autoScroll === "boolean" ? saved.autoScroll : DEFAULTS.autoScroll,
			comments: typeof saved.comments === "boolean" ? saved.comments : DEFAULTS.comments,
			muted: typeof saved.muted === "boolean" ? saved.muted : DEFAULTS.muted,
			rate: RATES.find(rate => rate === saved.rate) ?? DEFAULTS.rate,
		}
	} catch {
		return DEFAULTS
	}
}

export function usePlayerPrefs(): readonly [PlayerPrefs, (patch: Partial<PlayerPrefs>) => void] {
	// The server has no storage, so it draws the defaults; the saved prefs arrive with the first client read.
	const raw = useStoredValue(KEY)
	const prefs = useMemo(() => parsePrefs(raw), [raw])

	const update = useCallback((patch: Partial<PlayerPrefs>) => {
		writeStored(KEY, JSON.stringify({ ...parsePrefs(readStored(KEY)), ...patch }))
	}, [])

	return [prefs, update] as const
}
