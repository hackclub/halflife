import type { EventColour } from "@/app/generated/prisma/client"

/**
 * What a calendar surface needs, and nothing more.
 *
 * Declared here rather than imported from `lib/queries/events.ts` because the
 * client components read it and that module reaches for Prisma. The admin table
 * and the participant's calendar render the same shape from the same projection,
 * so a field cannot be present on one and missing on the other.
 */
export interface CalendarEvent {
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
 * - The calendar maths works in `YYYY-MM-DD` strings in the programme's zone,
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
	return EVENT_COLOURS.find((c) => c.id === colour) ?? SLATE_COLOUR
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

/**
 * Every calendar day in a month, as `YYYY-MM-DD`, padded at the front to a whole
 * number of weeks so the grid rows are full.
 *
 * The grid starts on Monday, not Sunday: a programme that runs to a Sunday close
 * reads better with Monday at the top, and every other row is seven days either
 * way.
 */
export function monthDays(year: number, month: number): string[] {
	// Day 0 of the next month is the last day of this one.
	const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
	const days = Array.from({ length: last }, (_, i) => dayKey(year, month, i + 1))
	// getUTCDay is 0 for Sunday, so Monday-first is a shift of one.
	const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
	return [...Array.from({ length: lead }, () => ""), ...days]
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

/**
 * The month `offset` months from the one `month` names, normalised.
 *
 * `month + offset` can land outside 1-12 (stepping back from January gives 0), so
 * it is run through a Date purely for its normalisation – UTC, because these are
 * calendar labels and a zone would only add the ambiguity this file exists to
 * avoid.
 */
export function shiftMonth(month: { year: number; month: number }, offset: number): { year: number; month: number } {
	const shifted = new Date(Date.UTC(month.year, month.month - 1 + offset, 1))
	return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 }
}

/** "March 2026" – the grid's own heading, with no day attached. */
export function monthLabel(year: number, month: number): string {
	return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
		new Date(Date.UTC(year, month - 1, 1)),
	)
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

/** "7:00 PM" in the programme's zone. */
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
	return events.filter((event) => calendarDay(event.startsAt, timeZone) === day)
}

/**
 * How many events each day in the month has, keyed by `YYYY-MM-DD`.
 *
 * Counted rather than kept as a set because a cell with two events should read
 * as busier than one with a single.
 */
export function eventCountsByDay(events: readonly CalendarEvent[], timeZone: string): Map<string, number> {
	const counts = new Map<string, number>()
	for (const event of events) {
		const day = calendarDay(event.startsAt, timeZone)
		counts.set(day, (counts.get(day) ?? 0) + 1)
	}
	return counts
}

/** The soonest event that has not finished, or null when the programme is clear. */
export function nextEvent<T extends CalendarEvent>(events: readonly T[], now: Date): T | null {
	return (
		[...events]
			.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
			.find((event) => eventIsUpcoming(event, now)) ?? null
	)
}
