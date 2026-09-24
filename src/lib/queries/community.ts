import "server-only"
import prisma from "@/lib/prisma"
import { HoursSource, PhaseStatus } from "@/app/generated/prisma/enums"
import { getProgramSettings, effectiveDateFor } from "@/lib/program"
import { getThemeDef } from "@/lib/config/program"

/**
 * The two pages that are about everyone else: Explore and the leaderboard.
 *
 * ## What is shown, and what is not
 *
 * Both are deliberately thin. A row carries a display name, an avatar, a
 * project title and numbers — never an email, a Slack id, a location or
 * anything under `encrypted*`. A leaderboard is a place where a careless
 * `select` leaks the whole user table, so these queries name every column they
 * want rather than spreading a row.
 *
 * Object keys are deliberately NOT here. R2 serves them publicly, so a key is
 * a capability to fetch that file — and the journal's photographs already ride
 * inside the body as Markdown, which is the copy this page renders. Shipping
 * the keys as well put every participant's session media into every other
 * participant's page payload for nothing.
 *
 * Journal bodies are shown as written. Participants write them knowing a
 * reviewer will read them, and the program already publishes reels to the
 * Doomscroller, so the audience is peers either way — but it is a real choice
 * and this is where it is made. Soft-deleted sessions and deleted projects are
 * excluded, so removing an entry removes it here too.
 */

export interface JournalRow {
  id: string
  author: string
  authorImage: string | null
  streak: number
  projectId: string
  project: string
  body: string
  minutes: number
  /** YYYY-MM-DD in the program timezone — what the day grouping reads. */
  day: string
  when: string
}

export interface LeaderRow {
  rank: number
  name: string
  hours: number
  ships: number
  streak: number
  you: boolean
}

const FEED_LIMIT = 60

export async function getJournalFeed(): Promise<JournalRow[]> {
  const [sessions, settings] = await Promise.all([
    prisma.workSession.findMany({
      where: { deletedAt: null, themeProject: { deletedAt: null } },
      // The id breaks ties, so two entries saved in the same millisecond keep
      // one order between loads.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: FEED_LIMIT,
      select: {
        id: true,
        content: true,
        title: true,
        hoursClaimed: true,
        hoursApproved: true,
        effectiveDate: true,
        createdAt: true,
        themeProject: {
          select: {
            id: true,
            title: true,
            theme: true,
            user: { select: { name: true, image: true, currentStreak: true } },
          },
        },
      },
    }),
    getProgramSettings(),
  ])

  return sessions.map((session) => {
    const project = session.themeProject
    return {
      id: session.id,
      author: project.user.name ?? "A maker",
      authorImage: project.user.image,
      streak: project.user.currentStreak,
      projectId: project.id,
      project: project.title || getThemeDef(project.theme).label,
      body: session.content ?? session.title,
      minutes: Math.round((session.hoursApproved ?? session.hoursClaimed) * 60),
      day:
        session.effectiveDate ??
        effectiveDateFor(session.createdAt, settings.programTimezone),
      when: session.createdAt.toISOString(),
    }
  })
}

const BOARD_LIMIT = 25

/**
 * Hours logged and weeks shipped.
 *
 * Hours are summed from journal sessions only. Hackatime time arrives through a
 * link rather than a session and would need a second aggregate per user to
 * include; leaving it out makes this a board about what people wrote down,
 * which is at least a rule that is the same for everyone.
 *
 * HACKATIME_TRACKED sessions are excluded for the reason they always are: their
 * hours already arrived through the link, so counting them here would pay some
 * people twice in the one place where the comparison is the whole point.
 */
export async function getLeaderboard(viewerId: string): Promise<LeaderRow[]> {
  const [sessions, ships, users] = await Promise.all([
    prisma.workSession.groupBy({
      by: ["themeProjectId"],
      where: {
        deletedAt: null,
        themeProject: { deletedAt: null },
        hoursSource: { not: HoursSource.HACKATIME_TRACKED },
      },
      _sum: { hoursClaimed: true },
    }),
    prisma.themeProject.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        userId: true,
        designStatus: true,
        buildStatus: true,
      },
    }),
    prisma.user.findMany({
      where: { joinedProgramAt: { not: null } },
      select: { id: true, name: true, currentStreak: true },
    }),
  ])

  const hoursByProject = new Map(
    sessions.map((s) => [s.themeProjectId, s._sum.hoursClaimed ?? 0]),
  )

  const hours = new Map<string, number>()
  const shipped = new Map<string, number>()
  for (const project of ships) {
    hours.set(
      project.userId,
      (hours.get(project.userId) ?? 0) + (hoursByProject.get(project.id) ?? 0),
    )
    // A theme is shipped when both its halves are approved — the same bar the
    // printer award uses, so the board and the award cannot disagree.
    if (
      project.designStatus === PhaseStatus.approved &&
      project.buildStatus === PhaseStatus.approved
    ) {
      shipped.set(project.userId, (shipped.get(project.userId) ?? 0) + 1)
    }
  }

  return users
    .map((user) => ({
      id: user.id,
      name: user.name ?? "A maker",
      hours: Math.round((hours.get(user.id) ?? 0) * 10) / 10,
      ships: shipped.get(user.id) ?? 0,
      streak: user.currentStreak,
    }))
    .filter((row) => row.hours > 0 || row.ships > 0)
    .sort((a, b) => b.ships - a.ships || b.hours - a.hours || a.name.localeCompare(b.name))
    .slice(0, BOARD_LIMIT)
    .map((row, index) => ({
      rank: index + 1,
      name: row.name,
      hours: row.hours,
      ships: row.ships,
      streak: row.streak,
      you: row.id === viewerId,
    }))
}
