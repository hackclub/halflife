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

const UTC_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	hour: "2-digit",
	hour12: false,
	minute: "2-digit",
	month: "short",
	timeZone: "UTC",
	year: "numeric",
})

/** en-GB spells September "Sept"; every month is trimmed to three letters so the console's columns stay even. */
function formatPinned(formatter: Intl.DateTimeFormat, at: Date | number): string {
	return formatter
		.formatToParts(at)
		.map(part => (part.type === "month" ? part.value.slice(0, 3) : part.value))
		.join("")
}

/** An audit or moderation timestamp, the one format every admin page uses, pinned to UTC: "18 Nov 2026, 22:00". */
export function formatUtcDateTime(at: Date | number): string {
	return formatPinned(UTC_DATE_TIME, at)
}

const UTC_DATE = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
	year: "numeric",
})

/** A calendar day as the console writes it, in UTC, so a date reads the same on the server and in any browser: "18 Nov 2026". */
export function formatUtcDate(at: Date | number): string {
	return formatPinned(UTC_DATE, at)
}
