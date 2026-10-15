import type { CalendarEvent } from "@/lib/events"
import prisma from "@/lib/prisma"

/**
 * The programme calendar's read paths.
 *
 * One module for both surfaces because the *shape* of an event is the same
 * whichever side is asking: the header countdown and the admin list would
 * disagree about a field if they each picked their own projection, and the
 * disagreement would only show up as a chip rendering `undefined` on one of them.
 * The shape itself is declared in `lib/events.ts`, which the client components can
 * import – this module reaches for Prisma, so they cannot.
 */

const SELECT = {
	colour: true,
	description: true,
	endsAt: true,
	id: true,
	published: true,
	seriesId: true,
	startsAt: true,
	title: true,
} satisfies Record<string, boolean>

/**
 * Published events from `from` onward, soonest first.
 *
 * The lower bound is a *cut-off*, not a filter on "has not started": an event that
 * started an hour ago and runs for two more is on the participant's screen right
 * now, and dropping it would leave the header counting to the one after it while
 * the current one is still happening. `take` is the caller's ceiling.
 */
export async function listUpcomingEvents(from: Date, take: number): Promise<CalendarEvent[]> {
	return prisma.programEvent.findMany({
		orderBy: { startsAt: "asc" },
		select: SELECT,
		take,
		where: { published: true, startsAt: { gte: from } },
	})
}

/**
 * The whole calendar, published or not, soonest first.
 *
 * The admin list is deliberately unbounded rather than paginated: the calendar is
 * bounded by the programme's ten weeks, not by anyone's patience, and a cursor
 * here would put a "next page" link on a list of at most a hundred rows.
 */
export async function listAllEvents(): Promise<CalendarEvent[]> {
	return prisma.programEvent.findMany({
		orderBy: { startsAt: "asc" },
		select: SELECT,
	})
}
