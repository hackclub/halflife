"use client"

import { type RefObject, useCallback, useEffect, useRef, useState } from "react"

/** One page as the API sends it. */
export interface RowsPage<T> {
	items: T[]
	nextCursor: string | null
}

/**
 * Rows that grow as the bottom of a list scrolls into view. The caller renders `rows` and puts `sentinel` under the last one.
 *
 * `baseUrl` is the API address for the list with its filters already in it. The cursor is added to it, so a new filter means a new base URL, and the caller remounts the list rather than appending to the old one.
 */
export function useInfiniteRows<T>({
	baseUrl,
	initialCursor,
	initialRows,
	isPage,
}: Readonly<{
	baseUrl: string
	initialCursor: string | null
	initialRows: T[]
	isPage(value: unknown): value is RowsPage<T>
}>): {
	cursor: string | null
	failed: boolean
	loadMore(): void
	loading: boolean
	rows: T[]
	sentinel: RefObject<HTMLDivElement | null>
} {
	const [rows, setRows] = useState(initialRows)
	const [cursor, setCursor] = useState(initialCursor)
	const [loading, setLoading] = useState(false)
	const [failed, setFailed] = useState(false)
	const sentinel = useRef<HTMLDivElement>(null)
	const busy = useRef(false)

	const loadMore = useCallback(async (): Promise<void> => {
		if (busy.current || cursor === null) return
		busy.current = true
		setLoading(true)
		setFailed(false)
		try {
			const separator = baseUrl.includes("?") ? "&" : "?"
			const res = await fetch(`${baseUrl}${separator}cursor=${encodeURIComponent(cursor)}`)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const page: unknown = await res.json()
			if (!isPage(page)) throw new Error("Unexpected response")
			setRows(current => [...current, ...page.items])
			setCursor(page.nextCursor)
		} catch {
			setFailed(true)
		} finally {
			busy.current = false
			setLoading(false)
		}
	}, [baseUrl, cursor, isPage])

	// The sentinel sits under the last row. Loading starts a screen early, so the next page is usually there before the reader reaches the end.
	useEffect(() => {
		const element = sentinel.current
		if (!element) return
		const observer = new IntersectionObserver(
			entries => {
				if (entries.some(entry => entry.isIntersecting)) void loadMore()
			},
			{ rootMargin: "600px 0px" },
		)
		observer.observe(element)
		return () => observer.disconnect()
	}, [loadMore])

	return { cursor, failed, loading, loadMore: () => void loadMore(), rows, sentinel }
}
