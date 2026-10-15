import type { EventColour } from "@/app/generated/prisma/client"

/**
 * What a calendar surface needs, and nothing more.
 *
 * Declared here rather than imported from `lib/queries/events.ts` because the
 * client components read it and that module reaches for Prisma. The admin table
 * and the participant's calendar render the same shape from the same projection,
 * so a field cannot be present on one and missing on the other.
 */
export type CalendarEvent = {
	id: string
	title: string
	colour: EventColour
	description: string | null
	startsAt: Date
	endsAt: Date | null
	published: boolean
	/** Set on every occurrence written together; null for a one-off. */
	seriesId: string | null
}

/** Every event joins the same huddle, so the link is a constant rather than a per-event field. */
export const HUDDLE_URL = "https://app.slack.com/huddle/T0266FRGM/C0BTE0WN23S"

/**
 * The programme calendar: what colour a row is, and how to say when one happens.
 *
 * Split into three parts on purpose:
 *
 * - `EVENT_COLOURS` is the display vocabulary. It is one list rather than two
 *   parallel maps because a colour missing from one of them is a swatch that
 *   renders `undefined`, which is exactly the failure that makes a calendar look
 *   broken.
 * - The colour helpers take a whole `CalendarEvent` where they need two fields,
 *   because a caller wanting the accent of an event should not have to remember
 *   that it is keyed off `colour` and not off `id`.
 * - The calendar maths works in `YYYY-MM-DD` strings in the viewer's zone, for
 *   the same reason `lib/program.ts` counts weeks in calendar days. Counting in
 *   elapsed milliseconds puts the late evening of a Sunday in the next column.
 */

export type { EventColour }

/**
 * The display name and swatch for every colour.
 *
 * The accents are the platform palette's, and they are not arbitrary: the ones
 * people plan around – the huddle and the show & tell – take the colours that
 * carry the most weight elsewhere in the app, and everything routine falls to
 * the muted pair.
 */
/** Named rather than picked off the end, so `eventColour` can fall back to it without an index. */
const SLATE_COLOUR = {
	id: "SLATE",
	label: "Slate",
	accent: "var(--color-navy-faint)",
} as const satisfies EventColourDef

export const EVENT_COLOURS = [
	{ id: "CORAL", label: "Coral", accent: "var(--color-coral)" },
	{ id: "SKY", label: "Sky", accent: "var(--color-sky)" },
	{ id: "VIOLET", label: "Violet", accent: "var(--color-violet)" },
	{ id: "GOLD", label: "Gold", accent: "var(--color-gold)" },
	{ id: "TEAL", label: "Teal", accent: "var(--color-teal)" },
	SLATE_COLOUR,
] as const satisfies readonly EventColourDef[]

export type EventColourDef = {
	readonly id: EventColour
	readonly label: string
	readonly accent: string
}

/**
 * The colour's own entry, for the label and the swatch.
 *
 * The fallback is the point: a colour added to the enum and not to the table above
 * renders as "Slate" rather than crashing a participant's header on a Monday.
 */
export function eventColour(colour: EventColour): EventColourDef {
	return EVENT_COLOURS.find(c => c.id === colour) ?? SLATE_COLOUR
}

/**
 * Whether the event is on now: it has started and has not ended. An event with no
 * end stays "on" until the next tick after its start, which is the honest reading
 * of an open call with no published end time.
 */
export function eventIsLive(event: Pick<CalendarEvent, "startsAt" | "endsAt">, now: Date): boolean {
	if (now < event.startsAt) return false
	return event.endsAt === null || now < event.endsAt
}

/**
 * Whether the event is still ahead. An event with no `endsAt` is ahead until it
 * starts, and past once it has – never indefinitely live, or a forgotten end
 * date would pin the header countdown at zero forever.
 */
export function eventIsUpcoming(event: Pick<CalendarEvent, "startsAt" | "endsAt">, now: Date): boolean {
	return now < (event.endsAt ?? event.startsAt)
}

/** Milliseconds until the event starts, floored at zero. */
export function msUntilStart(event: Pick<CalendarEvent, "startsAt">, now: Date): number {
	return Math.max(0, event.startsAt.getTime() - now.getTime())
}

/** The `YYYY-MM-DD` a moment falls on in `timeZone`. */
export function calendarDay(at: Date, timeZone: string): string {
	// en-CA formats as YYYY-MM-DD, which is the one thing Intl gives us that is
	// sortable as a string and readable as a date without parsing it back.
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(at)
}

/** `YYYY-MM-DD` for a year/month/day, zero-padded. */
export function dayKey(year: number, month: number, day: number): string {
	const pad = (n: number) => n.toString().padStart(2, "0")
	return `${year}-${pad(month)}-${pad(day)}`
}

/** The month a day string belongs to, for opening the grid on the right one. */
export function monthOf(day: string): { year: number; month: number } {
	const [year, month] = day.split("-").map(Number)
	return { year: year ?? 1970, month: month ?? 1 }
}

/** A `YYYY-MM-DD` shifted by whole days. UTC throughout: these are calendar labels, not instants. */
function addDays(day: string, offset: number): string {
	const [year = 1970, month = 1, dayOfMonth = 1] = day.split("-").map(Number)
	const at = new Date(Date.UTC(year, month - 1, dayOfMonth) + offset * 86_400_000)
	return dayKey(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate())
}

/** Monday-first index of a `YYYY-MM-DD` (0 = Monday), for the programme's Monday-to-Sunday weeks. */
function weekdayIndex(day: string): number {
	const [year = 1970, month = 1, dayOfMonth = 1] = day.split("-").map(Number)
	return (new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay() + 6) % 7
}

/** The Monday-to-Sunday week holding `day`, as `YYYY-MM-DD` strings. */
export function weekDays(day: string): string[] {
	const monday = addDays(day, -weekdayIndex(day))
	return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** `day`'s week moved by `offset` weeks. */
export function shiftWeek(day: string, offset: number): string {
	return addDays(day, offset * 7)
}

/** "March 2 – 8, 2026", widening to months and years when the week straddles them. */
export function weekLabel(days: readonly string[]): string {
	const [first = "", last = ""] = [days[0], days[6]]
	const [fy = 1970, fm = 1, fd = 1] = first.split("-").map(Number)
	const [ly = 1970, lm = 1, ld = 1] = last.split("-").map(Number)
	const month = (year: number, m: number) =>
		new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, m - 1, 1)))
	if (fy !== ly) return `${month(fy, fm)} ${fd}, ${fy} – ${month(ly, lm)} ${ld}, ${ly}`
	if (fm !== lm) return `${month(fy, fm)} ${fd} – ${month(ly, lm)} ${ld}, ${ly}`
	return `${month(fy, fm)} ${fd} – ${ld}, ${fy}`
}

/** Minutes from local midnight to `at` in `timeZone`. */
export function minutesInDay(at: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour: "numeric",
		minute: "numeric",
		hour12: false,
	}).formatToParts(at)
	const get = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0)
	// hour12: false reports midnight as 24, which is the next day's minute zero.
	return (get("hour") % 24) * 60 + get("minute")
}

/**
 * An event's slice of one calendar day in `timeZone`, clipped at midnight so a
 * block never leaks into the next column. Null when the event never touches
 * the day. Open-ended events get a nominal half hour so they still take a
 * block rather than vanishing.
 */
export function daySegment(
	event: Pick<CalendarEvent, "startsAt" | "endsAt">,
	day: string,
	timeZone: string,
): { startMin: number; endMin: number } | null {
	const starts = calendarDay(event.startsAt, timeZone)
	if (starts > day) return null
	const ends = event.endsAt ? calendarDay(event.endsAt, timeZone) : starts
	if (ends < day) return null
	const startMin = starts < day ? 0 : minutesInDay(event.startsAt, timeZone)
	let endMin: number
	if (!event.endsAt) endMin = Math.min(24 * 60, startMin + 30)
	else if (ends > day) endMin = 24 * 60
	else {
		endMin = minutesInDay(event.endsAt, timeZone)
		// An event running to midnight ends the day it is on, not the next one's first minute.
		if (endMin === 0) endMin = 24 * 60
	}
	return endMin <= startMin ? null : { startMin, endMin }
}

/** "Thursday, March 5" – a day's own heading, with no time attached. */
export function dayLabel(day: string): string {
	const { year, month } = monthOf(day)
	const dayOfMonth = Number(day.split("-")[2] ?? 1)
	return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(
		new Date(Date.UTC(year, month - 1, dayOfMonth)),
	)
}

/** "Thu Mar 5" – the short form, for a grid cell's accessible name. */
export function dayShort(day: string): string {
	const { year, month } = monthOf(day)
	const dayOfMonth = Number(day.split("-")[2] ?? 1)
	return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
		new Date(Date.UTC(year, month - 1, dayOfMonth)),
	)
}

/** "7:00 PM" in the given zone. */
function eventTimeLabel(at: Date, timeZone: string): string {
	return at.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
}

/** "7:00 – 8:00 PM", collapsing the meridiem when both ends share one. */
export function eventRangeLabel(startsAt: Date, endsAt: Date | null, timeZone: string): string {
	if (!endsAt) return eventTimeLabel(startsAt, timeZone)
	const from = eventTimeLabel(startsAt, timeZone)
	const to = eventTimeLabel(endsAt, timeZone)
	const meridiem = /\s(AM|PM)$/.exec(from)?.[1]
	// Same meridiem: showing it twice reads as a typo. Different: both keep theirs.
	return meridiem && to.endsWith(meridiem) ? `${from.replace(/\s(AM|PM)$/, "")} – ${to}` : `${from} – ${to}`
}

/**
 * The events falling on one calendar day in `timeZone`, in the order they start.
 *
 * An event that runs past midnight belongs to the day it *started*: a 9pm call
 * that ends at 11:30pm is tonight's, and a list that lost it overnight would be
 * wrong in the direction that matters.
 */
export function eventsOnDay<T extends CalendarEvent>(events: readonly T[], day: string, timeZone: string): T[] {
	return events.filter(event => calendarDay(event.startsAt, timeZone) === day)
}

/** The soonest event that has not finished, or null when the programme is clear. */
export function nextEvent<T extends CalendarEvent>(events: readonly T[], now: Date): T | null {
	return (
		[...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).find(event => eventIsUpcoming(event, now))
		?? null
	)
}
