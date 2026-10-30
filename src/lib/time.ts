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

/** A nullable Prisma 8 timestamp column as a Date, or null when the column is null. */
export const parseNullableTimestamp = (value: string | null): Date | null =>
	value === null ? null : parseDbTimestamp(value)

/** A timestamp column's runtime type after parsing: `Date` for a required column, `Date | null` for a nullable one. */
type ParsedTimestamp<T> = T extends string ? Date : T extends string | null ? Date | null : never

/**
 * The same row with the listed PostgreSQL timestamp columns parsed to Dates.
 *
 * The keys are explicit rather than inferred from the values at runtime: a string field can hold text that looks like a timestamp (a caption, a note), and silently rewriting it would corrupt content rather than fix a date. `keyof T` makes a typo a type error, and the return type keeps each column's nullability.
 */
export function parseTimestampFields<T extends object, K extends keyof T>(
	row: T,
	keys: readonly K[],
): Omit<T, K> & { [P in K]: ParsedTimestamp<T[P]> } {
	const out: { [_: PropertyKey]: unknown } = Object.fromEntries(Object.entries(row))
	for (const key of keys) {
		const value = out[key]
		out[key] = typeof value === "string" ? parseDbTimestamp(value) : null
	}
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TypeScript cannot construct a mapped type generically.
	return out as Omit<T, K> & { [P in K]: ParsedTimestamp<T[P]> }
}

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

/** A moment's calendar fields in `timeZone`, ordered for `Date.UTC`. */
export function wallClockFields(at: Date, timeZone: string): [number, number, number, number, number, number] {
	const parts = new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		hour: "numeric",
		hourCycle: "h23",
		minute: "numeric",
		month: "numeric",
		second: "numeric",
		timeZone,
		year: "numeric",
	}).formatToParts(at)
	const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0)
	return [value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")]
}

/** How far ahead of UTC a timezone's wall clock is at an instant, in ms. */
export function zoneOffsetMs(at: number, timeZone: string): number {
	const wall = Date.UTC(...wallClockFields(new Date(at), timeZone))
	return wall - (at - (at % 1000))
}

/**
 * The instant a wall-clock time (written as if it were UTC) happens in `timeZone`.
 *
 * Corrected by the zone's offset at that instant, then once more in case the first guess landed on the other side of a daylight-saving change.
 */
export function zonedWallTime(wall: number, timeZone: string): Date {
	const first = wall - zoneOffsetMs(wall, timeZone)
	return new Date(wall - zoneOffsetMs(first, timeZone))
}

/**
 * `weeks` calendar weeks after `at`, keeping the wall-clock time in `timeZone`.
 *
 * A plain `+ 7 * 86_400_000` would be an hour out for every occurrence after a daylight-saving change – which for a programme running autumn to winter is most of them, and it would quietly move a weekly call an hour without anyone noticing. Shifting the calendar fields instead resolves through the target date's offset, so a 7pm call stays at 7pm.
 */
export function addWeeksInZone(at: Date, weeks: number, timeZone: string): Date {
	if (weeks === 0) return at
	const [year, month, day, hour, minute, second] = wallClockFields(at, timeZone)
	// Date.UTC normalises an overflowing day, so adding the weeks to the day number is month arithmetic for us – and it lands on the same weekday, which is the entire point of counting in weeks rather than days.
	return zonedWallTime(Date.UTC(year, month, day + weeks * 7, hour, minute, second), timeZone)
}

/** Every `YYYY-MM-DD` from `first` to `last`, inclusive, for filling the gaps in a daily series. */
export function eachDayBetween(first: string, last: string): string[] {
	const out: string[] = []
	const end = Date.parse(`${last}T00:00:00Z`)
	for (let at = Date.parse(`${first}T00:00:00Z`); at <= end; at += DAY_MS)
		out.push(new Date(at).toISOString().slice(0, 10))
	return out
}
