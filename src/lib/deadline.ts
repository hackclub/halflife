/**
 * A deadline as people read one, e.g. "Sunday, October 5 at 11:59 PM", in the program's timezone.
 *
 * Pure, so the server's messages and the client's trail print it the same way.
 */
function formatDeadline(at: Date | number, timeZone: string, style: "long" | "short" = "long"): string {
	const shown = new Date(at)
	const day = shown.toLocaleDateString("en-US", { day: "numeric", month: style, timeZone, weekday: style })
	const time = shown.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })
	return `${day} at ${time}`
}

/**
 * A calendar date the short way – "Oct 5". For incidental dates (a submitted stamp, a series range), where the weekday and year the deadline formatter carries would be noise.
 */
function formatShortDate(at: Date | number | string): string {
	return new Date(at).toLocaleDateString("en-US", { day: "numeric", month: "short" })
}

/**
 * A Date as the value a `datetime-local` input takes, in the browser's own zone.
 *
 * The subtraction is what makes it local: `toISOString` would print UTC and the input would show a time offset from the one the reader picked.
 */
function toLocalInput(date: Date): string {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
	return local.toISOString().slice(0, 16)
}

const UTC_DATE_TIME = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "UTC",
})

/** An audit or moderation timestamp, pinned to UTC so the console does not disagree with itself between server and browser. */
function formatUtcDateTime(at: Date | number): string {
	return UTC_DATE_TIME.format(at)
}

export { formatDeadline, formatShortDate, formatUtcDateTime, toLocalInput }
