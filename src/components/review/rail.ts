"use client"

import { type RefObject, useEffect, useSyncExternalStore } from "react"

/**
 * The review rail's two folds, ported from Fabricate's `useRailToggle` and `useRailCollapse`.
 *
 * Hidden is one flag for the whole document, outside React, so the toggle in the rail's foot and the floating one that brings it back read and flip the same value. It lives for the page's life rather than in storage, as Fabricate's does: a full load, which is every way in from the platform, starts with the rail out.
 */
let hidden = false
const listeners = new Set<() => void>()

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

const typing = (el: EventTarget | null): boolean =>
	el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

export function toggleRail(): void {
	hidden = !hidden
	for (const listener of listeners) listener()
}

export const useRailHidden = (): boolean =>
	useSyncExternalStore(
		subscribe,
		() => hidden,
		() => false,
	)

/** Whether the rail is folded away, with Shift+Q bound to fold it, as on Fabricate's admin pages. */
export function useRailToggle(): boolean {
	const railHidden = useRailHidden()

	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.code !== "KeyQ" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
			e.preventDefault()
			toggleRail()
		}
		addEventListener("keydown", onKey)
		return () => removeEventListener("keydown", onKey)
	}, [])

	return railHidden
}

/**
 * At 1024px and under the rail is a top bar and its `<details>` is the drawer: shut by default there, open above it, and shut again on Escape or a press outside it.
 */
export function useRailCollapse(nav: RefObject<HTMLDetailsElement | null>): void {
	useEffect(() => {
		const el = nav.current
		if (!el) return
		const narrow = matchMedia("(max-width: 1024px)")

		// Through the attribute, which is what `open` reflects, so the element is told rather than a property on it reassigned.
		const setOpen = (open: boolean): void => {
			el.toggleAttribute("open", open)
		}
		const sync = (): void => setOpen(!narrow.matches)
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape" && narrow.matches) setOpen(false)
		}
		const onPointer = (e: PointerEvent): void => {
			if (narrow.matches && el.open && e.target instanceof Node && !el.contains(e.target)) setOpen(false)
		}

		narrow.addEventListener("change", sync)
		addEventListener("keydown", onKey)
		addEventListener("pointerdown", onPointer)
		sync()
		return () => {
			narrow.removeEventListener("change", sync)
			removeEventListener("keydown", onKey)
			removeEventListener("pointerdown", onPointer)
		}
	}, [nav])
}
