"use client"
import { useCallback, useEffect, useState } from "react"

/**
 * How this viewer likes the Doomscroller: sound, speed, whether it moves on by itself, and whether the comments stand open beside the reel.
 *
 * Per browser, in localStorage, the way the rest of the ceremony is kept: nobody else ever needs to read it, and a new laptop starting from the defaults is no loss. Every read and write is guarded – a private window or blocked storage just means the defaults, every visit.
 */
export interface PlayerPrefs {
	muted: boolean
	rate: number
	autoScroll: boolean
	comments: boolean
}

const KEY = "halflife.player.v1"
const DEFAULTS: PlayerPrefs = { muted: false, rate: 1, autoScroll: false, comments: true }

export const RATES = [1, 1.5, 2, 0.5] as const

export function usePlayerPrefs() {
	const [prefs, setPrefs] = useState<PlayerPrefs>(DEFAULTS)

	// After mount, because the server has no storage and must render the defaults; reading it during render would tear hydration.
	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(KEY)
			if (!raw) return
			const saved = JSON.parse(raw) as Partial<PlayerPrefs>
			// eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage
			setPrefs({
				muted: typeof saved.muted === "boolean" ? saved.muted : DEFAULTS.muted,
				rate: RATES.includes(saved.rate as (typeof RATES)[number]) ? (saved.rate as number) : DEFAULTS.rate,
				autoScroll: typeof saved.autoScroll === "boolean" ? saved.autoScroll : DEFAULTS.autoScroll,
				comments: typeof saved.comments === "boolean" ? saved.comments : DEFAULTS.comments,
			})
		} catch {
			/* storage unavailable – the defaults stand */
		}
	}, [])

	const update = useCallback((patch: Partial<PlayerPrefs>) => {
		setPrefs((prev) => {
			const next = { ...prev, ...patch }
			try {
				window.localStorage.setItem(KEY, JSON.stringify(next))
			} catch {
				/* quota or private mode – it holds for this visit */
			}
			return next
		})
	}, [])

	return [prefs, update] as const
}
