"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useStoredValue, writeStored } from "@/lib/browser-state"

/**
 * Fabricate's review-screen hooks (`useDraft`, `useAutosave`, `useStoredWidth`), ported unchanged in behaviour.
 *
 * Storage is read through `lib/browser-state`, so the server and the first client render agree and no effect has to copy a stored value into state. A private window or blocked site data throws on `localStorage`, and a draft that cannot be kept must still be typeable.
 */

/** A text field whose unsent value survives a reload, keyed per submission. */
export function useDraft(name: string, initial = ""): readonly [string, (value: string) => void, () => void] {
	const key = `halflife:review-draft:${name}`
	const stored = useStoredValue(key)
	const value = stored ?? initial

	const setValue = useCallback(
		(next: string) => {
			writeStored(key, next === initial ? null : next)
		},
		[key, initial],
	)

	const clear = useCallback(() => {
		writeStored(key, null)
	}, [key])

	return [value, setValue, clear] as const
}

export type AutosaveStatus = "saving" | "saved" | { error: string } | null

/**
 * Saves the latest value once edits pause, straight away on flush, and on unmount with keepalive so leaving the page does not drop the last change. Saves run one at a time, so an older value never lands after a newer one.
 */
export function useAutosave<T>(
	save: (value: T, keepalive: boolean) => Promise<void>,
	delay = 500,
): { change(value: T): void; flush(keepalive?: boolean): void; status: AutosaveStatus } {
	const [status, setStatus] = useState<AutosaveStatus>(null)
	const saveRef = useRef(save)
	const unsaved = useRef<{ value: T } | null>(null)
	const timer = useRef<number | undefined>(undefined)
	const queue = useRef(Promise.resolve())

	useEffect(() => {
		saveRef.current = save
	})

	const flush = useCallback((keepalive = false) => {
		window.clearTimeout(timer.current)
		const pending = unsaved.current
		if (!pending) return
		unsaved.current = null
		setStatus("saving")
		const previous = queue.current
		queue.current = (async () => {
			await previous
			try {
				await saveRef.current(pending.value, keepalive)
				if (!unsaved.current) setStatus("saved")
			} catch (err) {
				setStatus({ error: err instanceof Error ? err.message : "Couldn't save" })
			}
		})()
	}, [])

	const change = useCallback(
		(value: T) => {
			unsaved.current = { value }
			setStatus("saving")
			window.clearTimeout(timer.current)
			timer.current = window.setTimeout(flush, delay)
		},
		[delay, flush],
	)

	useEffect(() => () => flush(true), [flush])

	return { change, flush, status }
}

/** A panel width the reviewer dragged, remembered across visits. */
export function useStoredWidth(key: string, fallback: number): readonly [number, (next: number | null) => void] {
	const stored = Number(useStoredValue(key))
	const width = stored > 0 ? stored : fallback

	const update = useCallback(
		(next: number | null) => {
			writeStored(key, next === null ? null : String(Math.round(next)))
		},
		[key],
	)

	return [width, update] as const
}

/** Whether a stored flag is on, defaulting on, for the decision panel's show/hide. */
export function useStoredToggle(key: string): readonly [boolean, (next: boolean) => void] {
	const on = useStoredValue(key) !== "hidden"

	const update = useCallback(
		(next: boolean) => {
			writeStored(key, next ? "shown" : "hidden")
		},
		[key],
	)

	return [on, update] as const
}
