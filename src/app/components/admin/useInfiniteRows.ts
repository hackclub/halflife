"use client"

import { type RefObject, useCallback, useEffect, useRef, useState } from "react"

/** One page as the API sends it. */
export interface RowsPage<T> {
	items: T[]
	nextCursor: string | null
}

/**
 * The rows the reader has, with a fresh first page put in front of them. A row on the fresh page takes its fresh copy, so an edit the page was refreshed for shows; a row only loaded further down keeps what the reader already had.
 */
function mergeFreshRows<T>(loaded: T[], fresh: T[], keyOf: (row: T) => string): T[] {
	const freshKeys = new Set(fresh.map(keyOf))
	return [...fresh, ...loaded.filter(row => !freshKeys.has(keyOf(row)))]
}

/**
 * Rows that grow as the bottom of a list scrolls into view. The caller renders `rows` and puts `sentinel` under the last one.
 *
 * `baseUrl` is the API address for the list with its filters already in it. The cursor is added to it, so a new filter means a new base URL, and the caller remounts the list rather than appending to the old one.
 *
 * When the server re-renders the page with a new first page (after an action on a row refreshes it), `keyOf` says how to tell the rows apart, so the fresh page is merged in rather than ignored. Without it the rows stay as they were first loaded.
 */
export function useInfiniteRows<T>({
	baseUrl,
	initialCursor,
	initialRows,
	isPage,
	keyOf,
}: Readonly<{
	baseUrl: string
	initialCursor: string | null
	initialRows: T[]
	isPage(value: unknown): value is RowsPage<T>
	keyOf?(row: T): string
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
	const [fresh, setFresh] = useState(initialRows)
	const sentinel = useRef<HTMLDivElement>(null)
	const busy = useRef(false)

	// A new array from the server is a new first page. This is the one place state follows a prop, and only when the caller can match rows up.
	if (fresh !== initialRows) {
		setFresh(initialRows)
		if (keyOf) setRows(current => mergeFreshRows(current, initialRows, keyOf))
	}

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
