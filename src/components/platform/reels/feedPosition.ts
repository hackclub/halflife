/**
 * Where this viewer left off in the Doomscroller today, so closing the tab and coming back later does not start them from the top of the day again.
 *
 * Per browser, in localStorage, like the player prefs: a convenience, not a record, and a new laptop starting from the newest reel is no loss. Kept for the viewer's own day only – tomorrow the top of the feed is new, and that is where they should start. Every read and write is guarded.
 */
const KEY = "halflife.doomscroller.position.v1"

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
		const saved = JSON.parse(raw) as Partial<FeedPosition & { day: string }>
		if (saved.day !== today() || typeof saved.id !== "string") return null
		const leadIds = Array.isArray(saved.leadIds) ? saved.leadIds.filter((x) => typeof x === "string") : []
		return { id: saved.id, leadIds }
	} catch {
		return null
	}
}

export function savePosition(position: FeedPosition): void {
	try {
		window.localStorage.setItem(KEY, JSON.stringify({ ...position, day: today() }))
	} catch {
		/* quota or private mode – they start from the top next time */
	}
}
