"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/app/components/ui"
import { IconClipboard } from "@/app/components/ui/icons"

interface Props {
	/** The page that takes a `q` search parameter, such as `/admin/users`. */
	path: string
}

/**
 * Search whatever is on the clipboard without retyping it, for the case the search box exists for: an address or Slack ID copied from somewhere else.
 *
 * The pasted text becomes the page's own `q`, so the result is a normal search that can be linked, reloaded and paged.
 */
export function ClipboardSearchButton({ path }: Props) {
	const router = useRouter()
	const [reading, setReading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function searchClipboard() {
		setReading(true)
		setError(null)
		try {
			const text = (await navigator.clipboard.readText()).trim()
			if (!text) {
				setError("The clipboard is empty.")
				return
			}
			router.push(`${path}?${new URLSearchParams({ q: text })}`)
		} catch {
			// The browser may ask for permission or refuse outright outside a secure context. Say so, rather than leaving the button looking like it did nothing.
			setError("Could not read the clipboard. Check this site's permissions.")
		} finally {
			setReading(false)
		}
	}

	return (
		<>
			<Button disabled={reading} onClick={() => void searchClipboard()} type="button">
				<IconClipboard /> Paste &amp; search
			</Button>
			{error ? (
				<span className="hl-hint" role="alert">
					{error}
				</span>
			) : null}
		</>
	)
}
