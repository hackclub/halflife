import type { EventColour } from "@/app/generated/prisma/client"
import { calendarDay, DAY_MS } from "@/lib/time"

/**
 * What a calendar surface needs, and nothing more.
 *
 * Declared here rather than imported from `lib/queries/events.ts` because the
 * client components read it and that module reaches for Prisma. The admin table
 * and the participant's calendar render the same shape from the same projection,
 * so a field cannot be present on one and missing on the other.
 */
interface CalendarEvent {
	colour: EventColour
	description: string | null
	endsAt: Date | null
	id: string
	published: boolean
	/** Set on every occurrence written together; null for a one-off. */
	seriesId: string | null
	startsAt: Date
	title: string
}

/** Every event joins the same huddle, so the link is a constant rather than a per-event field. */
const HUDDLE_URL = "https://app.slack.com/huddle/T0266FRGM/C0BTE0WN23S"

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
	accent: "var(--color-navy-faint)",
	id: "SLATE",
	label: "Slate",
} as const satisfies EventColourDef

const EVENT_COLOURS = [
	{ accent: "var(--color-coral)", id: "CORAL", label: "Coral" },
	{ accent: "var(--color-sky)", id: "SKY", label: "Sky" },
	{ accent: "var(--color-violet)", id: "VIOLET", label: "Violet" },
	{ accent: "var(--color-gold)", id: "GOLD", label: "Gold" },
	{ accent: "var(--color-teal)", id: "TEAL", label: "Teal" },
	SLATE_COLOUR,
] as const satisfies readonly EventColourDef[]

interface EventColourDef {
	readonly accent: string
	readonly id: EventColour
	readonly label: string
}

/**
 * The colour's own entry, for the label and the swatch.
 *
 * The fallback is the point: a colour added to the enum and not to the table above
 * renders as "Slate" rather than crashing a participant's header on a Monday.
 */
function eventColour(colour: EventColour): EventColourDef {
	return EVENT_COLOURS.find(c => c.id === colour) ?? SLATE_COLOUR
}

/**
 * Whether the event is on now: it has started and has not ended. An event with no
 * end stays "on" until the next tick after its start, which is the honest reading
 * of an open call with no published end time.
 */
function eventIsLive(event: Pick<CalendarEvent, "startsAt" | "endsAt">, now: Date): boolean {
	if (now < event.startsAt) return false
	return event.endsAt === null || now < event.endsAt
}

/**
 * Whether the event is still ahead. An event with no `endsAt` is ahead until it
 * starts, and past once it has – never indefinitely live, or a forgotten end
 * date would pin the header countdown at zero forever.
 */
function eventIsUpcoming(event: Pick<CalendarEvent, "startsAt" | "endsAt">, now: Date): boolean {
	return now < (event.endsAt ?? event.startsAt)
}

/** Milliseconds until the event starts, floored at zero. */
function msUntilStart(event: Pick<CalendarEvent, "startsAt">, now: Date): number {
	return Math.max(0, event.startsAt.getTime() - now.getTime())
}

/** `YYYY-MM-DD` for a year/month/day, zero-padded. */
function dayKey(year: number, month: number, day: number): string {
	const pad = (n: number) => n.toString().padStart(2, "0")
	return `${year}-${pad(month)}-${pad(day)}`
}

/** The month a day string belongs to, for opening the grid on the right one. */
function monthOf(day: string): { year: number; month: number } {
	const [year, month] = day.split("-").map(Number)
	return { month: month ?? 1, year: year ?? 1970 }
}

/** A `YYYY-MM-DD` shifted by whole days. UTC throughout: these are calendar labels, not instants. */
function addDays(day: string, offset: number): string {
	const [year = 1970, month = 1, dayOfMonth = 1] = day.split("-").map(Number)
	const at = new Date(Date.UTC(year, month - 1, dayOfMonth) + offset * DAY_MS)
	return dayKey(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate())
}

/** Monday-first index of a `YYYY-MM-DD` (0 = Monday), for the programme's Monday-to-Sunday weeks. */
function weekdayIndex(day: string): number {
	const [year = 1970, month = 1, dayOfMonth = 1] = day.split("-").map(Number)
	return (new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay() + 6) % 7
}

/** The Monday-to-Sunday week holding `day`, as `YYYY-MM-DD` strings. */
function weekDays(day: string): string[] {
	const monday = addDays(day, -weekdayIndex(day))
	return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** `day`'s week moved by `offset` weeks. */
function shiftWeek(day: string, offset: number): string {
	return addDays(day, offset * 7)
}

/** "March 2 – 8, 2026", widening to months and years when the week straddles them. */
function weekLabel(days: readonly string[]): string {
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
function minutesInDay(at: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		hour12: false,
		minute: "numeric",
		timeZone,
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
function daySegment(
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
	return endMin <= startMin ? null : { endMin, startMin }
}

/** "Thursday, March 5" – a day's own heading, with no time attached. */
function dayLabel(day: string): string {
	const { year, month } = monthOf(day)
	const dayOfMonth = Number(day.split("-")[2] ?? 1)
	return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", timeZone: "UTC", weekday: "long" }).format(
		new Date(Date.UTC(year, month - 1, dayOfMonth)),
	)
}

/** "Thu Mar 5" – the short form, for a grid cell's accessible name. */
function dayShort(day: string): string {
	const { year, month } = monthOf(day)
	const dayOfMonth = Number(day.split("-")[2] ?? 1)
	return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", weekday: "short" }).format(
		new Date(Date.UTC(year, month - 1, dayOfMonth)),
	)
}

/** "7:00 PM" in the given zone. */
function eventTimeLabel(at: Date, timeZone: string): string {
	return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })
}

/** "7:00 – 8:00 PM", collapsing the meridiem when both ends share one. */
function eventRangeLabel(startsAt: Date, endsAt: Date | null, timeZone: string): string {
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
function eventsOnDay<T extends CalendarEvent>(events: readonly T[], day: string, timeZone: string): T[] {
	return events.filter(event => calendarDay(event.startsAt, timeZone) === day)
}

/** The soonest event that has not finished, or null when the programme is clear. */
function nextEvent<T extends CalendarEvent>(events: readonly T[], now: Date): T | null {
	return (
		[...events]
			.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
			.find(event => eventIsUpcoming(event, now)) ?? null
	)
}

export type { EventColour } from "@/app/generated/prisma/client"
export { calendarDay } from "@/lib/time"

export {
	type CalendarEvent,
	dayKey,
	dayLabel,
	daySegment,
	dayShort,
	EVENT_COLOURS,
	type EventColourDef,
	eventColour,
	eventIsLive,
	eventIsUpcoming,
	eventRangeLabel,
	eventsOnDay,
	HUDDLE_URL,
	minutesInDay,
	monthOf,
	msUntilStart,
	nextEvent,
	shiftWeek,
	weekDays,
	weekLabel,
}
