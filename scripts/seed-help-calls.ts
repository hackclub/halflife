import { DEFAULT_EVENT_START_DATE, DEFAULT_PROGRAM_TIMEZONE, TOTAL_WEEKS } from "../src/lib/config/program"
import { EventColour } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { formatDbTimestamp } from "../src/lib/time"

/**
 * `bun run seed-help-calls [--write]` – puts the hardware help call rota on the programme calendar for every week.
 *
 * Each slot below becomes one series of TOTAL_WEEKS rows, the same shape the admin form writes with `repeatWeeks`, so any one occurrence can still be moved or cancelled from the admin table. Times are Eastern wall-clock and stay put across the November clock change.
 *
 * Dry run by default. Re-running is safe: an occurrence already on the calendar with the same title and start is skipped.
 */

const WEEKDAY = Object.freeze({
	colour: EventColour.SKY,
	description:
		"Drop in if you need help, have questions about your project, need to lock in, or just want to hang out!",
	title: "Hardware Help Call/Lock-In Huddle",
})

const WEEKEND = Object.freeze({
	colour: EventColour.CORAL,
	description:
		"IT'S THE FINAL STRETCH! Get your project over the finish line! If you need last minute help with your project, this is the place for you!",
	title: "WEEKEND HELP/LOCK IN HUDDLE",
})

interface Slot {
	/** Monday-first, 0 = Monday. */
	day: number
	/** `HH:MM`, Eastern. */
	from: string
	host: string
	/** `HH:MM`, Eastern, on the same day as `from`. */
	to: string
}

const SLOTS: readonly Slot[] = Object.freeze([
	{ day: 0, from: "01:00", host: "Vynu", to: "02:00" },
	{ day: 1, from: "18:00", host: "cocotrilito", to: "21:00" },
	{ day: 2, from: "16:30", host: "Abean", to: "18:30" },
	{ day: 2, from: "19:30", host: "eceWire", to: "22:30" },
	{ day: 3, from: "16:00", host: "Xeno3ra", to: "19:00" },
	{ day: 3, from: "19:00", host: "eceWire", to: "22:00" },
	{ day: 4, from: "09:30", host: "ksshfii", to: "12:30" },
	{ day: 4, from: "14:30", host: "Ayush", to: "17:30" },
	{ day: 4, from: "19:30", host: "OJOkhiria", to: "22:30" },
	{ day: 5, from: "01:00", host: "Vynu", to: "02:00" },
	{ day: 5, from: "03:30", host: "Ayush", to: "06:30" },
	{ day: 5, from: "06:30", host: "Anay", to: "09:30" },
	{ day: 5, from: "10:00", host: "ksshfii", to: "13:00" },
	{ day: 5, from: "13:30", host: "Xeno3ra", to: "16:30" },
	{ day: 5, from: "17:00", host: "OJOkhiria", to: "18:00" },
	{ day: 5, from: "18:00", host: "cocotrilito", to: "20:30" },
	{ day: 5, from: "20:30", host: "Abean", to: "23:00" },
	{ day: 6, from: "00:30", host: "Vynu", to: "02:00" },
	{ day: 6, from: "03:30", host: "Ayush", to: "06:30" },
	{ day: 6, from: "06:30", host: "ksshfii", to: "09:00" },
	{ day: 6, from: "09:00", host: "Anay", to: "11:00" },
	{ day: 6, from: "11:00", host: "Abean", to: "13:00" },
	{ day: 6, from: "13:00", host: "Xeno3ra", to: "16:00" },
	{ day: 6, from: "16:00", host: "cocotrilito", to: "19:00" },
	{ day: 6, from: "19:00", host: "eceWire", to: "20:30" },
	{ day: 6, from: "20:30", host: "OJOkhiria", to: "23:00" },
])

/** A moment's calendar fields in `timeZone`, ordered for `Date.UTC`. */
function wallFields(at: Date, timeZone: string): [number, number, number, number, number, number] {
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
	const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value ?? 0)
	return [value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")]
}

const zoneOffsetMs = (at: number, timeZone: string): number => Date.UTC(...wallFields(new Date(at), timeZone)) - at

/** The instant `HH:MM` falls at, `dayOffset` days after the programme's first Monday, in `timeZone`. Two passes, as in the admin events route, so a guess on the far side of a clock change is corrected. */
function wallInstant(dayOffset: number, time: string, timeZone: string): Date {
	const [year = 1970, month = 1, day = 1] = DEFAULT_EVENT_START_DATE.split("-").map(Number)
	const [hour = 0, minute = 0] = time.split(":").map(Number)
	const wall = Date.UTC(year, month - 1, day + dayOffset, hour, minute)
	const first = wall - zoneOffsetMs(wall, timeZone)
	return new Date(wall - zoneOffsetMs(first, timeZone))
}

async function main() {
	const write = process.argv.includes("--write")
	const timeZone = DEFAULT_PROGRAM_TIMEZONE
	let created = 0
	let skipped = 0

	for (const slot of SLOTS) {
		const kind = slot.day >= 5 ? WEEKEND : WEEKDAY
		const occurrences = Array.from({ length: TOTAL_WEEKS }, (_, week) => ({
			endsAt: formatDbTimestamp(wallInstant(week * 7 + slot.day, slot.to, timeZone)),
			startsAt: wallInstant(week * 7 + slot.day, slot.from, timeZone),
		}))

		const existing = await db.orm.public.ProgramEvent.where({ title: kind.title })
			.where(event => event.startsAt.in(occurrences.map(o => formatDbTimestamp(o.startsAt))))
			.select("seriesId", "startsAt")
			.all()
		const taken = new Set<string>(existing.map(e => e.startsAt))
		const missing = occurrences.filter(o => !taken.has(formatDbTimestamp(o.startsAt)))
		skipped += occurrences.length - missing.length

		const [first] = occurrences
		if (first)
			console.log(
				`${first.startsAt.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", timeZone, weekday: "short" })} ${slot.host.padEnd(12)} ${kind.title}: ${missing.length} to create`,
			)
		if (!write || missing.length === 0) continue

		// Topping up a series keeps its id, so the slot stays one series in the admin table.
		const seriesId = existing.find(e => e.seriesId)?.seriesId ?? crypto.randomUUID()
		const rows = await db.orm.public.ProgramEvent.createAll(
			missing.map(o => ({
				colour: kind.colour,
				description: kind.description,
				endsAt: o.endsAt,
				published: true,
				seriesId,
				startsAt: formatDbTimestamp(o.startsAt),
				title: kind.title,
			})),
		)
		created += rows.length
	}

	console.log(write ? `created ${created}, skipped ${skipped} already there` : "dry run: pass --write to create")
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
