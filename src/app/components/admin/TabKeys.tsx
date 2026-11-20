"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

/**
 * Lets `[` and `]` step through a page's tabs, in the order the chips above it are drawn, wrapping at either end. A key typed into a field is left alone, and so is one pressed with a modifier.
 */
export function TabKeys({ current, hrefs }: Readonly<{ current: string; hrefs: string[] }>) {
	const router = useRouter()

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "[" && event.key !== "]") return
			// Holding a key repeats it; one press moves one tab, so a held key must not push a route per repeat.
			if (event.repeat) return
			if (event.metaKey || event.ctrlKey || event.altKey) return
			const { target } = event
			if (
				target instanceof HTMLElement
				&& (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))
			)
				return

			const index = hrefs.indexOf(current)
			if (index === -1 || hrefs.length < 2) return
			const step = event.key === "]" ? 1 : -1
			const href = hrefs[(index + step + hrefs.length) % hrefs.length]
			if (href === undefined) return
			event.preventDefault()
			router.push(href)
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [current, hrefs, router])

	return null
}
