import { DAY_MS } from "@/lib/time"

/** One programme week of a gap-filled daily series, with the mean over the days actually plotted in it. */
export interface WeekAverage {
	/** Mean active users a day over the plotted days of the week. */
	average: number
	/** Index of the last plotted day in the week. */
	end: number
	/** Index of the first plotted day in the week. */
	start: number
	/** Programme week: 0 is the first week, negative is before the programme. */
	week: number
}

/** Days since the epoch for a `YYYY-MM-DD` date, so subtracting two of them counts whole days. */
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS)

/**
 * Fold an ordered, gap-filled daily series into programme weeks, averaging each over the days the series covers.
 *
 * The boundary is the programme's own start date, not a calendar Monday: the season is scheduled in its own weeks, and the chart may begin before it in the warm-up. A week the series only partly covers – the first, before activity started, or the last, still in progress – is averaged over the days that are plotted, so a Wednesday start is not diluted by two days that are not on the chart, and the current week's bar grows towards its final height as the week fills in.
 */
export function weeklyAverages(days: readonly { day: string; users: number }[], programmeStart: string): WeekAverage[] {
	const firstDay = dayNumber(programmeStart)
	const weeks: WeekAverage[] = []
	let total = 0
	for (const [index, day] of days.entries()) {
		const week = Math.floor((dayNumber(day.day) - firstDay) / 7)
		const current = weeks.at(-1)
		if (current && current.week === week) {
			total += day.users
			current.end = index
			current.average = total / (index - current.start + 1)
		} else {
			total = day.users
			weeks.push({ average: day.users, end: index, start: index, week })
		}
	}
	return weeks
}
