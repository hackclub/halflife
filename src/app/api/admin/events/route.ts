import { ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { getProgramSettings, startOfDay } from "@/lib/program"
import { programEventCreateSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

/**
 * Put something on the programme calendar.
 *
 * `repeatWeeks` writes the whole series in one request. A standing weekly call is
 * the common case and asking an admin to press create ten times is how a calendar
 * ends up with three of the ten weeks on it. The occurrences are real rows rather
 * than a rule, so any one of them can be moved or cancelled later without a
 * migration – which is the edit that actually happens, when the week one call
 * lands on a holiday.
 *
 * The offsets are added in the programme's own zone, so a 7pm call stays at 7pm
 * after the clocks change instead of quietly becoming a 6pm call for the rest of
 * the season.
 */
export const POST = withRoute(async (req: Request) => {
	const gate = await requirePermission(Permission.MANAGE_PROGRAM)
	if (gate.error) return gate.error

	const parsed = await parseBody(req, programEventCreateSchema)
	if (parsed.error) return parsed.error
	const { repeatWeeks, ...fields } = parsed.data
	const { programTimezone } = await getProgramSettings()

	// One series id for the whole run, minted here rather than per row: it is what
	// makes "these ten are the weekly call" answerable later.
	const seriesId = repeatWeeks > 1 ? crypto.randomUUID() : null

	const events = await Promise.all(
		Array.from({ length: repeatWeeks }, (_, week) =>
			prisma.programEvent.create({
				data: {
					...fields,
					createdById: gate.user.id,
					description: fields.description ?? null,
					endsAt: fields.endsAt ? addWeeks(fields.endsAt, week, programTimezone) : null,
					seriesId,
					startsAt: addWeeks(fields.startsAt, week, programTimezone),
				},
				select: { id: true, startsAt: true },
			}),
		),
	)

	await logAudit({
		action: AuditAction.ADMIN_CREATE_PROGRAM_EVENT,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: {
			after: {
				colour: fields.colour,
				endsAt: fields.endsAt?.toISOString() ?? null,
				occurrences: repeatWeeks,
				published: fields.published,
				seriesId,
				startsAt: fields.startsAt.toISOString(),
				title: fields.title,
			},
		},
		// The series is the unit that was meant, so the audit row points at the run
		// rather than at whichever occurrence happened to be first.
		targetId: seriesId ?? events[0]?.id ?? null,
		targetType: "ProgramEvent",
	})

	return ok({ events, seriesId }, { status: 201 })
})

/**
 * `weeks` calendar weeks after `at`, keeping the wall-clock time in `timeZone`.
 *
 * A plain `+ 7 * 86_400_000` would be an hour out for every occurrence after a
 * daylight-saving change – which for a programme running autumn to winter is
 * most of them, and it would quietly move the weekly call an hour without anyone
 * noticing. So the shift is applied to the calendar fields and resolved back
 * through the zone's offset at the *target* date, correcting once more in case
 * the first guess landed on the other side of a transition. The same two-pass
 * adjustment `lib/program.ts` uses for a week's boundaries.
 */
function addWeeks(at: Date, weeks: number, timeZone: string): Date {
	if (weeks === 0) return at
	const [year, month, day, hour, minute, second] = wallFields(at, timeZone)
	// Date.UTC normalises an overflowing day, so adding the weeks to the day number
	// is a month arithmetic for us – and it lands on the same weekday, which is
	// the entire point of counting in weeks rather than days.
	const wall = Date.UTC(year, month, day + weeks * 7, hour, minute, second)
	const first = wall - zoneOffsetMs(wall, timeZone)
	return new Date(wall - zoneOffsetMs(first, timeZone))
}

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

function zoneOffsetMs(at: number, timeZone: string): number {
	const wall = Date.UTC(...wallFields(new Date(at), timeZone))
	return wall - (at - (at % 1000))
}

export const DELETE = withRoute(async (_req: Request) => {
	const gate = await requirePermission(Permission.MANAGE_PROGRAM)
	if (gate.error) return gate.error

	const { programTimezone } = await getProgramSettings()
	const threshold = startOfDay(new Date(), programTimezone)

	const { count } = await prisma.programEvent.deleteMany({ where: { startsAt: { gte: threshold } } })

	await logAudit({
		action: AuditAction.ADMIN_DELETE_PROGRAM_EVENT,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { threshold: threshold.toISOString(), upcomingCleared: count },
		targetId: null,
		targetType: "ProgramEvent",
	})

	return ok({ deleted: count })
})
