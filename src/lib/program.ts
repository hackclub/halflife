import "server-only"
import { cache } from "react"
import type { ProgramSettings } from "@/app/generated/prisma/client"
import { PhaseStatus } from "@/app/generated/prisma/enums"
import { DEFAULT_EVENT_START_DATE, DEFAULT_PROGRAM_TIMEZONE, TOTAL_WEEKS } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import prisma from "@/lib/prisma"
import { calendarDayNumber, DAY_MS, effectiveDateFor, utcCalendarDay } from "@/lib/time"

/**
 * The settings row is created on demand so a fresh database is usable without a seed step having run first.
 *
 * Read once per server render: the layout's snapshot, the page, the week number and the access gates all ask for it, and each asking was a round trip. Nothing writes the row and then reads it back in the same render.
 */
const getProgramSettings = cache(async (): Promise<ProgramSettings> => {
	const existing = await prisma.programSettings.findUnique({ where: { id: "singleton" } })
	if (existing) return existing
	return prisma.programSettings.create({
		data: {
			eventStartDate: new Date(`${DEFAULT_EVENT_START_DATE}T00:00:00.000Z`),
			id: "singleton",
			programTimezone: DEFAULT_PROGRAM_TIMEZONE,
		},
	})
})

/**
 * Program week for a date, in the program's timezone.
 *
 * Week 1 is the seven days from eventStartDate. Returns 0 before the program opens and TOTAL_WEEKS + 1 or higher after it ends, so callers can distinguish "not started" from "over" without a second query.
 *
 * Counted in calendar days rather than elapsed milliseconds: a week flips at program-timezone midnight, the same instant `weekOpensAt` starts the next. Counting from the UTC epoch would stamp the last four or five hours of every Sunday evening in New York – the hours people actually journal in – into the next week while the current one is still open.
 *
 * The start is anchored to its UTC calendar date, which is what `eventStartDate` stores (see `weekClosesAt`), while the moment being placed is read in the program's timezone.
 */
function weekNumberForDate(start: Date, date: Date, timeZone: string): number {
	const elapsed = calendarDayNumber(date, timeZone) - utcCalendarDay(start)
	if (elapsed < 0) return 0
	return Math.floor(elapsed / 7) + 1
}

/**
 * The span a program week covers, in the program's own timezone: the midnight its first day opens at, and the 11:59 PM its last day closes at.
 *
 * Derived from `weekOpensAt` and `weekClosesAt` rather than counted in elapsed milliseconds from the start date, because those are the instants the server enforces. A range that ended hours before the deadline it describes would tell a client the week closed early, and counting UTC instants drifts by an hour across a daylight-saving change.
 */
function weekDateRange(
	settings: Pick<ProgramSettings, "eventStartDate" | "programTimezone">,
	week: number,
): { start: Date; end: Date } | null {
	if (week < 1 || week > TOTAL_WEEKS) return null
	return { end: weekClosesAt(settings, week), start: weekOpensAt(settings, week) }
}

/**
 * Midnight after a program week's last day, in the program's timezone, so it is the same instant in New York as on a server in Frankfurt.
 *
 * `eventStartDate` is stored as UTC midnight of the calendar day the program opens (the admin form reads it back with `toISOString().slice(0, 10)`), so its UTC date is the program's first day, and week N's last day is 7N - 1 days after it.
 */
function midnightAfterWeek(settings: Pick<ProgramSettings, "eventStartDate" | "programTimezone">, week: number): Date {
	const start = settings.eventStartDate
	// The Monday after the week, as a wall-clock midnight in the program zone.
	const wall = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + week * 7)
	return zonedWallTime(wall, settings.programTimezone)
}

/** Midnight at the start of the day `at` falls on in `timeZone`. */
function startOfDay(at: Date, timeZone: string): Date {
	const [year, month, day] = effectiveDateFor(at, timeZone).split("-")
	return zonedWallTime(Date.UTC(Number(year), Number(month) - 1, Number(day)), timeZone)
}

/**
 * The instant a wall-clock time (written as if it were UTC) happens in `timeZone`. Corrected by the zone's offset at that instant, then once more in case the first guess landed on the other side of a daylight-saving change.
 */
function zonedWallTime(wall: number, timeZone: string): Date {
	const first = wall - zoneOffsetMs(wall, timeZone)
	return new Date(wall - zoneOffsetMs(first, timeZone))
}

/** How far before midnight a week closes: the deadline is 11:59 PM, not 12:00 AM. */
const CLOSE_BEFORE_MIDNIGHT_MS = 60 * 1000

/**
 * The moment a program week stops taking work: 11:59 PM on its last day, in the program's timezone. Anything at 11:59 or later is refused; the minute to midnight belongs to no week.
 */
function weekClosesAt(settings: Pick<ProgramSettings, "eventStartDate" | "programTimezone">, week: number): Date {
	return new Date(midnightAfterWeek(settings, week).getTime() - CLOSE_BEFORE_MIDNIGHT_MS)
}

/**
 * The moment a program week starts taking work: midnight at the start of its Monday in the program's timezone, a minute after the week before it closes. Week 1's is the program's first midnight.
 */
function weekOpensAt(settings: Pick<ProgramSettings, "eventStartDate" | "programTimezone">, week: number): Date {
	return midnightAfterWeek(settings, week - 1)
}

/**
 * Refuse work on a curriculum week that has not opened. Nothing on the trail can be started early, the first checkpoint included; the client locks the same weeks, and this is what holds when a request goes around it.
 *
 * Week 0 is the warm-up, which is not scheduled and never waits.
 */
async function assertWeekStarted(week: number): Promise<void> {
	if (week < 1) return
	const settings = await getProgramSettings()
	const opensAt = weekOpensAt(settings, week)
	if (new Date() < opensAt)
		throw new HttpError(
			"WEEK_NOT_STARTED",
			`Week ${week} opens on ${formatProgramDate(opensAt, settings.programTimezone)}.`,
		)
}

/** How far ahead of UTC a timezone's wall clock is at an instant, in ms. */
function zoneOffsetMs(at: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		hour: "numeric",
		hourCycle: "h23",
		minute: "numeric",
		month: "numeric",
		second: "numeric",
		timeZone,
		year: "numeric",
	}).formatToParts(new Date(at))
	const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value ?? 0)
	const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"))
	return wall - (at - (at % 1000))
}

/**
 * When a week closes for one participant's project: its scheduled close, or later if either extension column says so. The same two overrides that reopen submissions reopen a passed week, so an admin granting more time has one lever to pull rather than two.
 */
function effectiveWeekClose(closesAt: Date, ...extensions: (Date | null | undefined)[]): Date {
	return extensions.reduce<Date>((latest, ext) => (ext && ext > latest ? ext : latest), closesAt)
}

const WEEK_CLOSED_MESSAGE =
	"This week has passed! Submit what you have. If you need more time, ask in the Slack channel."

/**
 * Whether work can still be logged against a project's week. Passed weeks can still be submitted – that is the whole point of closing them – but not added to, edited or trimmed.
 */
async function isWeekOpen(userId: string, themeProjectId: string, week: number): Promise<boolean> {
	const [settings, user, project] = await Promise.all([
		getProgramSettings(),
		prisma.user.findUnique({
			select: { submissionExtensionUntil: true },
			where: { id: userId },
		}),
		prisma.themeProject.findUnique({
			select: { submissionExtensionUntil: true },
			where: { id: themeProjectId },
		}),
	])
	const closesAt = effectiveWeekClose(
		weekClosesAt(settings, week),
		user?.submissionExtensionUntil,
		project?.submissionExtensionUntil,
	)
	return new Date() < closesAt
}

async function currentWeekNumber(): Promise<number> {
	const settings = await getProgramSettings()
	return weekNumberForDate(settings.eventStartDate, new Date(), settings.programTimezone)
}

function formatProgramDate(date: Date, timeZone: string): string {
	return date.toLocaleDateString("en-US", {
		day: "numeric",
		month: "long",
		timeZone,
		year: "numeric",
	})
}

// ─── Access gates ────────────────────────────────────────────────────────────

type SubmissionAccessReason = "OPEN" | "USER_EXTENSION" | "PROJECT_EXTENSION" | "CLOSED" | "NOT_STARTED"

interface SubmissionAccess {
	closesAt: Date | null
	extensionUntil: Date | null
	open: boolean
	reason: SubmissionAccessReason
}

/**
 * Whether this participant may still write to this project.
 *
 * Two levels of override, both as columns rather than manual database surgery: a per-user one covering everything they do, and a per-project one. Either being in the future opens the gate.
 */
async function getSubmissionAccess(userId: string, themeProjectId?: string): Promise<SubmissionAccess> {
	const now = new Date()
	const [settings, user, project] = await Promise.all([
		getProgramSettings(),
		prisma.user.findUnique({
			select: { submissionExtensionUntil: true },
			where: { id: userId },
		}),
		themeProjectId
			? prisma.themeProject.findUnique({
					select: { submissionExtensionUntil: true },
					where: { id: themeProjectId },
				})
			: Promise.resolve(null),
	])

	const userExt = user?.submissionExtensionUntil ?? null
	const projectExt = project?.submissionExtensionUntil ?? null

	const globallyOpen = settings.submissionsOpen && (!settings.submissionsCloseAt || settings.submissionsCloseAt > now)

	if (globallyOpen)
		return {
			closesAt: settings.submissionsCloseAt,
			extensionUntil: null,
			open: true,
			reason: "OPEN",
		}

	if (userExt && userExt > now)
		return {
			closesAt: settings.submissionsCloseAt,
			extensionUntil: userExt,
			open: true,
			reason: "USER_EXTENSION",
		}

	if (projectExt && projectExt > now)
		return {
			closesAt: settings.submissionsCloseAt,
			extensionUntil: projectExt,
			open: true,
			reason: "PROJECT_EXTENSION",
		}

	return {
		closesAt: settings.submissionsCloseAt,
		extensionUntil: null,
		open: false,
		reason: "CLOSED",
	}
}

const SUBMISSIONS_CLOSED_MESSAGE = "Submissions are closed. If you need an extension, ask in the Slack channel."

type ShopAccessReason = "OPEN" | "PENDING_REVIEW" | "GRACE_PERIOD" | "CLOSED"

interface ShopAccess {
	closesAt: Date | null
	graceUntil: Date | null
	open: boolean
	reason: ShopAccessReason
}

/**
 * What a maker's review activity buys them past the shop's close date.
 *
 * The shop stays open while anything is awaiting review, and for a grace window after the latest review. Pure, so the purchase transaction can ask the same question of the rows it just read instead of re-deriving the rule next to the money.
 */
interface ShopGraceState {
	awaitingReview: number
	buildReviewedAt: Date | null
	designReviewedAt: Date | null
}

function shopGraceAccess(
	settings: { shopGraceDays: number },
	state: ShopGraceState,
	now: Date = new Date(),
): { graceUntil: Date | null; open: boolean } {
	if (state.awaitingReview > 0) return { graceUntil: null, open: true }

	// The last review is a max over every project's two review dates, not the most recently *updated* row: editing a title or granting an extension bumps `updatedAt` without touching a review, which would mask a review that just landed and close the grace window early.
	const [reviewedAt] = [state.designReviewedAt, state.buildReviewedAt]
		.filter((d): d is Date => Boolean(d))
		.toSorted((a, b) => b.getTime() - a.getTime())
	if (!reviewedAt) return { graceUntil: null, open: false }

	const graceUntil = new Date(reviewedAt.getTime() + settings.shopGraceDays * DAY_MS)
	return { graceUntil, open: graceUntil > now }
}

/**
 * The shop stays open past its close date for anyone with work still in the queue, and for a grace window after their last review – otherwise credit awarded at the buzzer is unspendable through no fault of the participant.
 */
async function getShopAccess(userId: string): Promise<ShopAccess> {
	const now = new Date()
	const settings = await getProgramSettings()

	const closesAt = settings.shopClosesAt
	const beforeClose = !closesAt || closesAt > now

	if (settings.shopOpen && beforeClose) return { closesAt, graceUntil: null, open: true, reason: "OPEN" }

	if (!settings.shopOpen) return { closesAt, graceUntil: null, open: false, reason: "CLOSED" }

	const [awaitingReview, lastReview] = await Promise.all([
		prisma.themeProject.count({
			where: { deletedAt: null, OR: [{ designStatus: "in_review" }, { buildStatus: "in_review" }], userId },
		}),
		// The last review is a max over every project's two review dates, not the most recently *updated* row: editing a title or granting an extension bumps `updatedAt` without touching a review, which would mask a review that just landed and close the grace window early.
		prisma.themeProject.aggregate({
			_max: { buildReviewedAt: true, designReviewedAt: true },
			where: { deletedAt: null, userId },
		}),
	])

	const grace = shopGraceAccess(
		settings,
		{
			awaitingReview,
			buildReviewedAt: lastReview._max.buildReviewedAt,
			designReviewedAt: lastReview._max.designReviewedAt,
		},
		now,
	)
	if (!grace.open) return { closesAt, graceUntil: null, open: false, reason: "CLOSED" }
	return {
		closesAt,
		graceUntil: grace.graceUntil,
		open: true,
		reason: grace.graceUntil ? "GRACE_PERIOD" : "PENDING_REVIEW",
	}
}

const SHOP_CLOSED_MESSAGE =
	"The shop is closed. It stays open while you have work awaiting review, and for a short window after your last review."

/**
 * A decided phase is frozen. Its entries are the record the decision was made against, so no edit, delete or new entry may land until an admin returns it or un-approves it – either of which moves it back to `update_requested`.
 *
 * `in_review` is a separate, softer lock: that one is released by the participant unsubmitting, so it is checked apart from this.
 */
function isPhaseDecided(status: PhaseStatus): boolean {
	return status === PhaseStatus.approved || status === PhaseStatus.rejected
}

/**
 * The phase statuses in which a project's own details may no longer change: one a reviewer is reading right now, and one already decided.
 *
 * A decided phase is frozen everywhere else too – its entries, its parts list and its tier are the record the decision was made against – so the title, description, repo link, cover and artifact links cannot change under it either.
 */
const FROZEN_PHASE_STATUSES: PhaseStatus[] = [PhaseStatus.in_review, PhaseStatus.approved, PhaseStatus.rejected]

/**
 * Why a project's own details cannot change right now, or null when they can.
 *
 * One place, so the route that refuses the edit and the page that says so cannot disagree about which phases are frozen.
 */
function projectEditLockReason(project: { buildStatus: PhaseStatus; designStatus: PhaseStatus }): string | null {
	if (project.designStatus === PhaseStatus.in_review || project.buildStatus === PhaseStatus.in_review)
		return "In review, so it can't be edited. Unsubmit to change it"
	if (isPhaseDecided(project.designStatus) || isPhaseDecided(project.buildStatus))
		return "A phase of this project has been decided, so its details are final"
	return null
}

/**
 * Re-exported rather than kept here: the check itself belongs next to the other shape helpers, because a zone is validated where it is typed and this module is server-only.
 */
export { isTimeZone } from "@/lib/schemas/common"
export { effectiveDateFor } from "@/lib/time"

export {
	assertWeekStarted,
	currentWeekNumber,
	effectiveWeekClose,
	FROZEN_PHASE_STATUSES,
	formatProgramDate,
	getProgramSettings,
	getShopAccess,
	getSubmissionAccess,
	isPhaseDecided,
	isWeekOpen,
	projectEditLockReason,
	SHOP_CLOSED_MESSAGE,
	type ShopAccess,
	type ShopAccessReason,
	type ShopGraceState,
	SUBMISSIONS_CLOSED_MESSAGE,
	type SubmissionAccess,
	type SubmissionAccessReason,
	shopGraceAccess,
	startOfDay,
	WEEK_CLOSED_MESSAGE,
	weekClosesAt,
	weekDateRange,
	weekNumberForDate,
	weekOpensAt,
}
