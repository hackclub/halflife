/**
 * A deadline as people read one, e.g. "Sunday, October 5 at 11:59 PM", in the program's timezone.
 *
 * Pure, so the server's messages and the client's trail print it the same way.
 *
 * Through `Intl.DateTimeFormat` rather than `toLocaleDateString`/`toLocaleTimeString`. A Chrome left open across the clocks going back keeps the old offset for the `toLocale*` methods even with a `timeZone` given, so on 1 November 2026 it printed the 11:59 PM close as 12:59 AM Monday and the trail failed to hydrate against the server's correct text. `Intl.DateTimeFormat` in the same browser read the zone's rules afresh and was right.
 */
export function formatDeadline(at: Date | number, timeZone: string, style: "long" | "short" = "long"): string {
	const shown = new Date(at)
	const day = new Intl.DateTimeFormat("en-US", { day: "numeric", month: style, timeZone, weekday: style }).format(shown)
	const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(shown)
	return `${day} at ${time}`
}

/**
 * A calendar date the short way – "Oct 5". For incidental dates (a submitted stamp, a series range), where the weekday and year the deadline formatter carries would be noise.
 */
export function formatShortDate(at: Date | number | string): string {
	return new Date(at).toLocaleDateString("en-US", { day: "numeric", month: "short" })
}

/**
 * A Date as the value a `datetime-local` input takes, in the browser's own zone.
 *
 * The subtraction is what makes it local: `toISOString` would print UTC and the input would show a time offset from the one the reader picked.
 */
export function toLocalInput(date: Date): string {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
	return local.toISOString().slice(0, 16)
}

const UTC_DATE_TIME = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "UTC",
})

/** An audit or moderation timestamp, pinned to UTC so the console does not disagree with itself between server and browser. */
export function formatUtcDateTime(at: Date | number): string {
	return UTC_DATE_TIME.format(at)
}
