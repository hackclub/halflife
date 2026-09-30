"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import type { FeedItem, FeedPage } from "@/lib/feed"

/**
 * The Doomscroller's rows.
 *
 * Fetched from the client rather than handed down from a server component,
 * because this is the one surface on the platform that is genuinely endless:
 * it pages as you scroll, and the rail and the full-page view want the same
 * rows without one of them re-rendering a layout to get them.
 *
 * Today's admin reels come back as their own list rather than spliced in.
 * Paginating one cursor across two orderings is how a feed starts skipping
 * rows, so the server keeps them apart and they are simply put first here.
 */
export function useFeed(limit = 12) {
  const [items, setItems] = useState<FeedItem[]>([])
  // Today's admin reels, as the first page put them in front of the rest.
  const [leading, setLeading] = useState<FeedItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Guards against a scroll handler firing again while the first page is still
  // in the air, which would append the same rows twice.
  const inFlight = useRef(false)

  const load = useCallback(
    async (after: string | null) => {
      if (inFlight.current || done) return
      inFlight.current = true
      try {
        const query = new URLSearchParams({ limit: String(limit) })
        if (after) query.set("cursor", after)
        // So "an admin's reel from today" means the viewer's today.
        else query.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone)
        const res = await fetch(`/api/feed?${query}`)
        if (!res.ok) throw new Error(`The feed did not load (${res.status})`)
        const page = (await res.json()) as FeedPage
        if (!after) setLeading(page.leading)
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id))
          const fresh = [...page.leading, ...page.items].filter((i) => !seen.has(i.id))
          return [...prev, ...fresh]
        })
        setCursor(page.nextCursor)
        if (!page.nextCursor) setDone(true)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : "The feed did not load")
      } finally {
        setLoading(false)
        inFlight.current = false
      }
    },
    [limit, done],
  )

  // Fetching the first page is the external-system sync an effect is for, and
  // every state update inside `load` happens after the await — the rule cannot
  // see that through the call, so it is exempted here rather than worked around
  // with a timeout that would only add a frame of blank feed.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- updates land after await
    void load(null)
  }, [load])

  return {
    items,
    leading,
    loading,
    error,
    done,
    // `load` never raises the loading flag itself: everything it sets happens
    // after an await, which is what keeps the mount effect free of the
    // synchronous setState that cascades renders. Asking for more is a click,
    // so it can flip the flag here.
    more: useCallback(() => {
      setLoading(true)
      void load(cursor)
    }, [load, cursor]),
    /** Replace one row in place, for a like that has already been sent. */
    patch: useCallback((id: string, next: Partial<FeedItem>) => {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...next } : i)))
    }, []),
  }
}
