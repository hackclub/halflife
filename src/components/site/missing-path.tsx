"use client"

import { usePathname } from "next/navigation"

/** The address that was asked for, as the 404's station label. */
export function MissingPath({ className }: { className?: string }) {
	const pathname = usePathname()
	if (!pathname) return null
	return <p className={className}>{pathname}</p>
}
