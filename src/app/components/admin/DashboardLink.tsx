"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useAltHeld } from "./use-alt-held"

/**
 * The way back to the maker's own dashboard, with the console's Alt+B shortcut and its key cap while Alt is held. It sits in the header rather than in the sidebar because it is not a page inside the console's own sections.
 */
export function DashboardLink() {
	const router = useRouter()
	const altHeld = useAltHeld()

	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent): void => {
			if (event.repeat || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
			// The typed letter first, then the physical code, as the sidebar's own shortcuts do: Option+B on a Mac stops printing a letter.
			const typed = event.key.length === 1 ? event.key.toLowerCase() : ""
			const physical = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : ""
			if (typed !== "b" && physical !== "b") return
			event.preventDefault()
			router.push("/dashboard")
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [router])

	return (
		<Link aria-keyshortcuts="Alt+B" className="hl-admin-dashboard" href="/dashboard">
			Back to dashboard
			{altHeld ? <kbd className="hl-hotkey">B</kbd> : null}
		</Link>
	)
}
