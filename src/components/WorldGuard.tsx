"use client"

import { useEffect } from "react"

/**
 * A last line of defence against a page drawn in the other world's stylesheet.
 *
 * The site and the platform are separate root layouts with their own `globals.css`. Crossing between them must be a full document load; a client transition can leave the landing's body and stylesheet in place while the platform's HTML arrives, which paints the trail in the landing's ink with system fonts and square panels. Reloading fixes it, which is the tell.
 *
 * `HardLink` keeps the links across the two worlds honest, and this catches the cases a link cannot – a restored history entry, a redirect, a framework transition. The body carries the world it was rendered for, so a mismatch is unambiguous and one reload is the whole repair.
 */
export function WorldGuard({ world }: { world: "site" | "platform" }) {
	useEffect(() => {
		if (document.body.dataset.world === world) return
		window.location.reload()
	}, [world])

	return null
}
