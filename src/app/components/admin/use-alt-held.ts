"use client"

import { useEffect, useState } from "react"

/**
 * Whether Alt is being held, for the key caps that reveal the console's shortcuts while it is down.
 *
 * AltGr arrives as Ctrl+Alt and is typing, not a shortcut, so it does not count. Losing focus mid-Alt never sends the keyup, so blur clears the caps too.
 */
export function useAltHeld(): boolean {
	const [held, setHeld] = useState(false)

	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent): void => {
			if (event.key === "Alt" && !event.ctrlKey && !event.metaKey && !event.shiftKey) setHeld(true)
		}
		const onKeyUp = (event: globalThis.KeyboardEvent): void => {
			if (event.key === "Alt") setHeld(false)
		}
		const onBlur = (): void => setHeld(false)
		window.addEventListener("keydown", onKeyDown)
		window.addEventListener("keyup", onKeyUp)
		window.addEventListener("blur", onBlur)
		return () => {
			window.removeEventListener("keydown", onKeyDown)
			window.removeEventListener("keyup", onKeyUp)
			window.removeEventListener("blur", onBlur)
		}
	}, [])

	return held
}
