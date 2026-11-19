const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * How long until an extension runs out, as the deadlines page prints it: "in 3d 4h", "in 5h 30m" or "in 40m".
 *
 * Pure, so the server page and the test read the same answer. A deadline already past reads as "expired" rather than a negative duration.
 */
export function formatRemaining(expiresAt: Date, now: Date): string {
	const diff = expiresAt.getTime() - now.getTime()
	if (diff <= 0) return "expired"
	const days = Math.floor(diff / DAY_MS)
	if (days > 0) {
		const hours = Math.floor((diff - days * DAY_MS) / HOUR_MS)
		if (hours === 0) return `in ${days}d`
		return `in ${days}d ${hours}h`
	}
	const hours = Math.floor(diff / HOUR_MS)
	const minutes = Math.floor((diff - hours * HOUR_MS) / MINUTE_MS)
	if (hours > 0) {
		if (minutes === 0) return `in ${hours}h`
		return `in ${hours}h ${minutes}m`
	}
	return `in ${Math.max(minutes, 1)}m`
}

/** The badge tone for a remaining duration: red under a day, amber under three days, quiet beyond that. */
export function remainingTone(expiresAt: Date, now: Date): "danger" | "warning" | "muted" {
	const diff = expiresAt.getTime() - now.getTime()
	if (diff < DAY_MS) return "danger"
	if (diff < 3 * DAY_MS) return "warning"
	return "muted"
}
