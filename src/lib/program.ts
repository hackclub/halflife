import "server-only"
import { cache } from "react"
import type { ProgramSettings } from "@/app/generated/prisma/client"
import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { DEFAULT_EVENT_START_DATE, DEFAULT_PROGRAM_TIMEZONE, TOTAL_WEEKS } from "@/lib/config/program"
import prisma from "@/lib/prisma"

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/**
 * The settings row is created on demand so a fresh database is usable without a
 * seed step having run first.
 *
 * Read once per server render: the layout's snapshot, the page, the week
 * number and the access gates all ask for it, and each asking was a round
 * trip. Nothing writes the row and then reads it back in the same render.
 */
export const getProgramSettings = cache(async (): Promise<ProgramSettings> => {
  const existing = await prisma.programSettings.findUnique({ where: { id: "singleton" } })
  if (existing) return existing
  return prisma.programSettings.create({
    data: {
      id: "singleton",
      eventStartDate: new Date(`${DEFAULT_EVENT_START_DATE}T00:00:00.000Z`),
      programTimezone: DEFAULT_PROGRAM_TIMEZONE,
    },
  })
})

/**
 * Program week for a date, in the program's timezone.
 *
 * Week 1 is the seven days from eventStartDate. Returns 0 before the program
 * opens and TOTAL_WEEKS + 1 or higher after it ends, so callers can distinguish
 * "not started" from "over" without a second query.
 *
 * Counted in calendar days rather than elapsed milliseconds: a week flips at
 * program-timezone midnight, the same instant `weekClosesAt` stops taking work.
 * Counting from the UTC epoch would stamp the last four or five hours of every
 * Sunday evening in New York — the hours people actually journal in — into the
 * next week while the current one is still open.
 *
 * The start is anchored to its UTC calendar date, which is what `eventStartDate`
 * stores (see `weekClosesAt`), while the moment being placed is read in the
 * program's timezone.
 */
export function weekNumberForDate(start: Date, date: Date, timeZone: string): number {
  const elapsed = calendarDay(date, timeZone) - utcCalendarDay(start)
  if (elapsed < 0) return 0
  return Math.floor(elapsed / 7) + 1
}

/** Days since the epoch for a moment's calendar date in `timeZone`. */
function calendarDay(date: Date, timeZone: string): number {
  const [year, month, day] = effectiveDateFor(date, timeZone).split("-")
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / DAY_MS)
}

/** Days since the epoch for a moment's own UTC calendar date. */
function utcCalendarDay(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS)
}

export function weekDateRange(start: Date, week: number): { start: Date; end: Date } | null {
  if (week < 1 || week > TOTAL_WEEKS) return null
  const weekStart = new Date(start.getTime() + (week - 1) * WEEK_MS)
  // End of the last day, not the start of the next week, so a "closes on"
  // label reads correctly.
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS - 1)
  return { start: weekStart, end: weekEnd }
}

/**
 * The moment a program week stops taking work: midnight after its Sunday, in
 * the program's timezone, so "the week ends Sunday at 11:59pm" means the same
 * thing in New York as it does on a server in Frankfurt.
 *
 * `eventStartDate` is stored as UTC midnight of the calendar day the program
 * opens (the admin form reads it back with `toISOString().slice(0, 10)`), so
 * its UTC date is the program's first day, and week N's last day is 7N - 1
 * days after it.
 */
export function weekClosesAt(
  settings: Pick<ProgramSettings, "eventStartDate" | "programTimezone">,
  week: number,
): Date {
  const start = settings.eventStartDate
  // The Monday after the week, as a wall-clock midnight in the program zone.
  const wall = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + week * 7)
  // Correct by the zone's offset at that instant, then once more in case the
  // first guess landed on the other side of a daylight-saving change.
  const first = wall - zoneOffsetMs(wall, settings.programTimezone)
  return new Date(wall - zoneOffsetMs(first, settings.programTimezone))
}

/** How far ahead of UTC a timezone's wall clock is at an instant, in ms. */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(at))
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"))
  return wall - (at - (at % 1000))
}

/**
 * When a week closes for one participant's project: its scheduled close, or
 * later if either extension column says so. The same two overrides that
 * reopen submissions reopen a passed week, so an admin granting more time
 * has one lever to pull rather than two.
 */
export function effectiveWeekClose(closesAt: Date, ...extensions: (Date | null | undefined)[]): Date {
  return extensions.reduce<Date>((latest, ext) => (ext && ext > latest ? ext : latest), closesAt)
}

export const WEEK_CLOSED_MESSAGE =
  "This week has passed! Submit what you have. If you need more time, ask in the Slack channel."

/**
 * Whether work can still be logged against a project's week. Passed weeks can
 * still be submitted — that is the whole point of closing them — but not
 * added to, edited or trimmed.
 */
export async function isWeekOpen(userId: string, themeProjectId: string, week: number): Promise<boolean> {
  const [settings, user, project] = await Promise.all([
    getProgramSettings(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { submissionExtensionUntil: true },
    }),
    prisma.themeProject.findUnique({
      where: { id: themeProjectId },
      select: { submissionExtensionUntil: true },
    }),
  ])
  const closesAt = effectiveWeekClose(
    weekClosesAt(settings, week),
    user?.submissionExtensionUntil,
    project?.submissionExtensionUntil,
  )
  return new Date() < closesAt
}

export async function currentWeekNumber(): Promise<number> {
  const settings = await getProgramSettings()
  return weekNumberForDate(settings.eventStartDate, new Date(), settings.programTimezone)
}

/**
 * The YYYY-MM-DD a moment falls on in the program's timezone.
 *
 * Doing this in the program timezone rather than the server's is not
 * pedantry: siege computes week buckets against the server clock, so its
 * per-week hour totals shift if the container moves region.
 */
export function effectiveDateFor(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

export function formatProgramDate(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

// ─── Access gates ────────────────────────────────────────────────────────────

export type SubmissionAccessReason = "OPEN" | "USER_EXTENSION" | "PROJECT_EXTENSION" | "CLOSED" | "NOT_STARTED"

export interface SubmissionAccess {
  open: boolean
  reason: SubmissionAccessReason
  closesAt: Date | null
  extensionUntil: Date | null
}

/**
 * Whether this participant may still write to this project.
 *
 * Two levels of override, both as columns rather than manual database surgery:
 * a per-user one covering everything they do, and a per-project one. Either
 * being in the future opens the gate.
 */
export async function getSubmissionAccess(userId: string, themeProjectId?: string): Promise<SubmissionAccess> {
  const now = new Date()
  const [settings, user, project] = await Promise.all([
    getProgramSettings(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { submissionExtensionUntil: true },
    }),
    themeProjectId
      ? prisma.themeProject.findUnique({
          where: { id: themeProjectId },
          select: { submissionExtensionUntil: true },
        })
      : Promise.resolve(null),
  ])

  const userExt = user?.submissionExtensionUntil ?? null
  const projectExt = project?.submissionExtensionUntil ?? null

  const globallyOpen = settings.submissionsOpen && (!settings.submissionsCloseAt || settings.submissionsCloseAt > now)

  if (globallyOpen) {
    return {
      open: true,
      reason: "OPEN",
      closesAt: settings.submissionsCloseAt,
      extensionUntil: null,
    }
  }
  if (userExt && userExt > now) {
    return {
      open: true,
      reason: "USER_EXTENSION",
      closesAt: settings.submissionsCloseAt,
      extensionUntil: userExt,
    }
  }
  if (projectExt && projectExt > now) {
    return {
      open: true,
      reason: "PROJECT_EXTENSION",
      closesAt: settings.submissionsCloseAt,
      extensionUntil: projectExt,
    }
  }
  return {
    open: false,
    reason: "CLOSED",
    closesAt: settings.submissionsCloseAt,
    extensionUntil: null,
  }
}

export const SUBMISSIONS_CLOSED_MESSAGE = "Submissions are closed. If you need an extension, ask in the Slack channel."

export type ShopAccessReason = "OPEN" | "PENDING_REVIEW" | "GRACE_PERIOD" | "CLOSED"

export interface ShopAccess {
  open: boolean
  reason: ShopAccessReason
  closesAt: Date | null
  graceUntil: Date | null
}

/**
 * The shop stays open past its close date for anyone with work still in the
 * queue, and for a grace window after their last review — otherwise credit
 * awarded at the buzzer is unspendable through no fault of the participant.
 */
export async function getShopAccess(userId: string): Promise<ShopAccess> {
  const now = new Date()
  const settings = await getProgramSettings()

  const closesAt = settings.shopClosesAt
  const beforeClose = !closesAt || closesAt > now

  if (settings.shopOpen && beforeClose) {
    return { open: true, reason: "OPEN", closesAt, graceUntil: null }
  }
  if (!settings.shopOpen) {
    return { open: false, reason: "CLOSED", closesAt, graceUntil: null }
  }

  const [awaitingReview, lastReview] = await Promise.all([
    prisma.themeProject.count({
      where: { userId, deletedAt: null, OR: [{ designStatus: "in_review" }, { buildStatus: "in_review" }] },
    }),
    // The last review is a max over every project's two review dates, not the
    // most recently *updated* row: editing a title or granting an extension
    // bumps `updatedAt` without touching a review, which would mask a review
    // that just landed and close the grace window early.
    prisma.themeProject.aggregate({
      where: { userId, deletedAt: null },
      _max: { designReviewedAt: true, buildReviewedAt: true },
    }),
  ])

  if (awaitingReview > 0) {
    return { open: true, reason: "PENDING_REVIEW", closesAt, graceUntil: null }
  }

  const reviewedAt = [lastReview._max.designReviewedAt, lastReview._max.buildReviewedAt]
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0]

  if (reviewedAt) {
    const graceUntil = new Date(reviewedAt.getTime() + settings.shopGraceDays * DAY_MS)
    if (graceUntil > now) {
      return { open: true, reason: "GRACE_PERIOD", closesAt, graceUntil }
    }
  }
  return { open: false, reason: "CLOSED", closesAt, graceUntil: null }
}

export const SHOP_CLOSED_MESSAGE =
  "The shop is closed. It stays open while you have work awaiting review, and for a short window after your last review."

export function phaseStatusField(phase: Phase): "designStatus" | "buildStatus" {
  return phase === Phase.DESIGN ? "designStatus" : "buildStatus"
}

/**
 * A decided phase is frozen. Its entries are the record the decision was made
 * against, so no edit, delete or new entry may land until an admin returns it
 * or un-approves it — either of which moves it back to `update_requested`.
 *
 * `in_review` is a separate, softer lock: that one is released by the
 * participant unsubmitting, so it is checked apart from this.
 */
export function isPhaseDecided(status: PhaseStatus): boolean {
  return status === PhaseStatus.approved || status === PhaseStatus.rejected
}
