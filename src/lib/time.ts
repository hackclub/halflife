/**
 * Calendar-day helpers, in the program's timezone.
 *
 * These were three implementations of one idea: `effectiveDateFor` in the server-only `program.ts`, `calendarDay` in the client-facing `events.ts`, and a private `calendarDay` inside `program.ts` that returned a day *number* under the same name as the string one. Nothing here touches the database, so both sides can use the same reading.
 *
 * The string form is `YYYY-MM-DD`. `en-CA` is the one Intl locale that formats it that way, so it sorts as a string and reads as a date without being parsed back.
 */

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A Prisma 8 `TimestampString(3)` value as a Date.
 *
 * The Prisma 8 contract prints a `timestamp(3)` column the way PostgreSQL stores it, such as `2026-10-22 14:25:05.757`, with no zone. The program's convention is that those values are UTC, and `new Date(value)` would read the space-separated form as local time.
 */
export const parseDbTimestamp = (value: string): Date => new Date(`${value.replace(" ", "T")}Z`)

/** A Date as the text a Prisma 8 `TimestampString(3)` field accepts. */
export const formatDbTimestamp = (date: Date): string => date.toISOString().replace("T", " ").replace("Z", "")

/** The `YYYY-MM-DD` a moment falls on in `timeZone`. */
export function calendarDay(at: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		day: "2-digit",
		month: "2-digit",
		timeZone,
		year: "numeric",
	}).format(at)
}

/**
 * The same calendar day under its older name.
 *
 * Kept because the program's own code reads as "effective date" – the day a journal entry counts for – while the calendar surfaces read as "calendar day".
 */
export { calendarDay as effectiveDateFor }

/** Days since the epoch for a moment's calendar date in `timeZone`. */
export function calendarDayNumber(at: Date, timeZone: string): number {
	const [year, month, day] = calendarDay(at, timeZone).split("-")
	return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / DAY_MS)
}

/** Days since the epoch for a moment's own UTC calendar date. */
export function utcCalendarDay(at: Date): number {
	return Math.floor(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) / DAY_MS)
}

/** Every `YYYY-MM-DD` from `first` to `last`, inclusive, for filling the gaps in a daily series. */
export function eachDayBetween(first: string, last: string): string[] {
	const out: string[] = []
	const end = Date.parse(`${last}T00:00:00Z`)
	for (let at = Date.parse(`${first}T00:00:00Z`); at <= end; at += DAY_MS)
		out.push(new Date(at).toISOString().slice(0, 10))
	return out
}
