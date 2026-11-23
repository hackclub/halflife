"use client"

import type { Route } from "next"
import { useRouter } from "next/navigation"

/**
 * The Reset link above a list. Navigating to the unfiltered address alone leaves the fields as they were: they are uncontrolled, so React reuses the same inputs and keeps whatever was typed or chosen in them. This clears the form back to the values its fields were rendered with, then goes to the address without filters.
 */
export function ResetFilters<R extends string>({ href }: Readonly<{ href: Route<R> }>) {
	const router = useRouter()

	return (
		<a
			className="hl-hint"
			href={href}
			onClick={event => {
				event.preventDefault()
				event.currentTarget.closest("form")?.reset()
				router.push(href)
			}}
		>
			Reset
		</a>
	)
}
