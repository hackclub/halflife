/**
 * A deadline as people read one, e.g. "Sunday, October 5 at 11:59 PM", in the program's timezone.
 *
 * Pure, so the server's messages and the client's trail print it the same way.
 */
export function formatDeadline(at: Date | number, timeZone: string, style: "long" | "short" = "long"): string {
	const shown = new Date(at)
	const day = shown.toLocaleDateString("en-US", { day: "numeric", month: style, timeZone, weekday: style })
	const time = shown.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })
	return `${day} at ${time}`
}

/**
 * A calendar date the short way – "Oct 5". For incidental dates (a submitted stamp, a series range), where the weekday and year the deadline formatter carries would be noise.
 */
export function formatShortDate(at: Date | number | string): string {
	return new Date(at).toLocaleDateString("en-US", { day: "numeric", month: "short" })
}
