import { z } from "zod"
import { useArrivalValue } from "@/lib/browser-state"

/**
 * Where this viewer left off in the Doomscroller today, so closing the tab and coming back later does not start them from the top of the day again.
 *
 * Per browser, in localStorage, like the player prefs: a convenience, not a record, and a new laptop starting from the newest reel is no loss. Kept for the viewer's own day only – tomorrow the top of the feed is new, and that is where they should start. Every read and write is guarded.
 */
const KEY = "halflife.doomscroller.position.v1"

/** The saved position, with the day it was saved for. Parsed, because a hand-edited or stale row must not place the viewer somewhere the feed cannot resolve. */
const SavedPositionSchema = z.object({
	day: z.string(),
	id: z.string(),
	leadIds: z.array(z.string()).optional(),
})

export interface FeedPosition {
	/** The reel they were on. */
	id: string
	/** The admin reels they had been shown leading the feed, so one posted since can still go first. */
	leadIds: string[]
}

/** The viewer's calendar day, in their own timezone. */
function today(): string {
	return new Date().toLocaleDateString("en-CA")
}

export function readPosition(): FeedPosition | null {
	try {
		const raw = window.localStorage.getItem(KEY)
		if (!raw) return null
		const parsed = SavedPositionSchema.safeParse(JSON.parse(raw))
		if (!parsed.success || parsed.data.day !== today()) return null
		return { id: parsed.data.id, leadIds: parsed.data.leadIds ?? [] }
	} catch {
		return null
	}
}

/** Where the viewer arrived: the reel a card's link asked for, or else where they left off. */
export interface Arrival {
	/** The reel a link asked for, and whether that link wanted its comments open. */
	deep: { comments: boolean; id: string } | null
	/** Where they left off today, when no link named a reel. */
	saved: FeedPosition | null
}

function readArrival(): Arrival {
	const params = new URLSearchParams(window.location.search)
	const id = params.get("reel")
	if (id) return { deep: { comments: params.get("comments") === "1", id }, saved: null }
	return { deep: null, saved: readPosition() }
}

/** The arrival, read once on the client and undefined on the server, so the walk starts only once it is known. */
export function useArrival(): Arrival | undefined {
	return useArrivalValue(readArrival)
}

export function savePosition(position: FeedPosition): void {
	try {
		window.localStorage.setItem(KEY, JSON.stringify({ ...position, day: today() }))
	} catch {
		/* quota or private mode – they start from the top next time */
	}
}
