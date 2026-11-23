"use client"

import type { Route } from "next"
import Link from "next/link"
import type { ReactNode } from "react"
import { useStore } from "@/lib/store"

/**
 * A link into a doc. Opening an article is the moment someone commits to reading, so it folds the Doomscroller away and hands the width back to the page. The Doomscroller button in the header brings it back.
 */
export function ArticleLink<R extends string>({
	href,
	className,
	children,
}: {
	href: Route<R>
	className?: string
	children: ReactNode
}) {
	const { setDoomscroller } = useStore()

	return (
		<Link className={className} href={href} onClick={() => setDoomscroller(false)}>
			{children}
		</Link>
	)
}
