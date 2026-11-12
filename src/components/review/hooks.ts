"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Fabricate's review-screen hooks (`useDraft`, `useAutosave`, `useStoredWidth`), ported unchanged in behaviour.
 *
 * Every storage access is wrapped: a private window or blocked site data throws on `localStorage`, and a draft that cannot be kept must still be typeable.
 */

function read(key: string): string | null {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

function write(key: string, value: string | null): void {
	try {
		if (value === null) localStorage.removeItem(key)
		else localStorage.setItem(key, value)
	} catch {
		// Storage is a convenience here; losing it loses only the draft.
	}
}

/** A text field whose unsent value survives a reload, keyed per submission. */
export function useDraft(name: string, initial = ""): readonly [string, (value: string) => void, () => void] {
	const key = `halflife:review-draft:${name}`
	const [value, setValue] = useState(initial)

	// Read after mount, not during render: the server has no storage, and reading it in the initialiser would hydrate a different value from the one the server drew.
	useEffect(() => {
		const stored = read(key)
		if (stored !== null) setValue(stored)
	}, [key])

	useEffect(() => {
		write(key, value === initial ? null : value)
	}, [key, value, initial])

	const clear = useCallback(() => {
		write(key, null)
		setValue(initial)
	}, [key, initial])

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
	const [width, setWidth] = useState(fallback)

	useEffect(() => {
		const stored = Number(read(key))
		if (stored > 0) setWidth(stored)
	}, [key])

	const update = useCallback(
		(next: number | null) => {
			setWidth(next ?? fallback)
			write(key, next === null ? null : String(Math.round(next)))
		},
		[key, fallback],
	)

	return [width, update] as const
}

/** Whether a stored flag is on, defaulting on, for the decision panel's show/hide. */
export function useStoredToggle(key: string): readonly [boolean, (next: boolean) => void] {
	const [on, setOn] = useState(true)

	// After mount, not in render: the server has no storage, and the first client render has to match what it drew.
	useEffect(() => {
		// oxlint-disable-next-line react/no-deriving-state-in-effects -- localStorage is only readable after hydration
		setOn(read(key) !== "hidden")
	}, [key])

	const update = useCallback(
		(next: boolean) => {
			setOn(next)
			write(key, next ? "shown" : "hidden")
		},
		[key],
	)

	return [on, update] as const
}
