"use client"

import Link from "next/link"
import type { MouseEvent, ReactNode } from "react"

/**
 * A link that leaves the current document.
 *
 * The site, the platform and the handoff page are separate root layouts, and a client navigation between them leaves the old stylesheet in front of the new one – the platform rendered in the landing's ink, with system fonts and square panels. Reloading fixes it, which is the tell. A full document load is the only transition between the two worlds that is certain to bring the right stylesheet with it.
 *
 * Modified clicks are left alone so "open in new tab" still works.
 */
export function HardLink({ children, className, href }: { children: ReactNode; className?: string; href: string }) {
	const go = (event: MouseEvent<HTMLAnchorElement>) => {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
		event.preventDefault()
		window.location.assign(href)
	}

	return (
		<Link className={className} href={href} onClick={go}>
			{children}
		</Link>
	)
}
