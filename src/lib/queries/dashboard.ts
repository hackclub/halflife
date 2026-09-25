import "server-only"
import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { getThemeDef, scheduleForWeek, THEMES } from "@/lib/config/program"
import { type Balances, getBalances, getEarnedCredit } from "@/lib/currency"
import { getHoursBreakdown } from "@/lib/hours"
import { getPrinterQualification } from "@/lib/printer"
import prisma from "@/lib/prisma"
import { currentWeekNumber, effectiveDateFor, getProgramSettings, weekDateRange } from "@/lib/program"
import { streakAsOf } from "@/lib/streak"

export interface ThemeCard {
  id: string
  theme: string
  slug: string
  label: string
  blurb: string
  title: string
  designStatus: PhaseStatus
  buildStatus: PhaseStatus
  designWeek: number
  buildWeek: number
  tier: number | null
  grantUsd: number | null
  designHours: number
  buildHours: number
  shipped: boolean
}

export interface DashboardData {
  currentWeek: number
  weekRange: { start: Date; end: Date } | null
  focus: { themeLabel: string; phase: Phase } | null
  timezone: string
  balances: Balances
  earned: number
  /** Expired against today, so a run that lapsed reads 0 rather than stale. */
  streak: number
  longestStreak: number
  printer: Awaited<ReturnType<typeof getPrinterQualification>>
  cards: ThemeCard[]
}

export async function getDashboard(userId: string): Promise<DashboardData> {
  const [settings, currentWeek, projects, user, balances, earned, printer] = await Promise.all([
    getProgramSettings(),
    currentWeekNumber(),
    prisma.themeProject.findMany({ where: { userId, deletedAt: null } }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { currentStreak: true, longestStreak: true, lastStreakDate: true },
    }),
    prisma.$transaction((tx) => getBalances(tx, userId)),
    prisma.$transaction((tx) => getEarnedCredit(tx, userId)),
    getPrinterQualification(userId),
  ])

  const byTheme = new Map(projects.map((p) => [p.theme, p]))

  const cards: ThemeCard[] = []
  for (const def of THEMES) {
    const project = byTheme.get(def.id)
    if (!project) continue
    const [design, build] = await Promise.all([
      getHoursBreakdown(project.id, Phase.DESIGN),
      getHoursBreakdown(project.id, Phase.BUILD),
    ])
    cards.push({
      id: project.id,
      theme: project.theme,
      slug: def.slug,
      label: def.label,
      blurb: def.blurb,
      title: project.title,
      designStatus: project.designStatus,
      buildStatus: project.buildStatus,
      designWeek: def.designWeek,
      buildWeek: def.buildWeek,
      tier: project.tier,
      grantUsd: project.grantUsd,
      designHours: design.effectiveHours,
      buildHours: build.effectiveHours,
      shipped: project.designStatus === PhaseStatus.approved && project.buildStatus === PhaseStatus.approved,
    })
  }

  const scheduled = scheduleForWeek(currentWeek)

  return {
    currentWeek,
    weekRange: weekDateRange(settings.eventStartDate, currentWeek),
    focus: scheduled ? { themeLabel: getThemeDef(scheduled.theme.id).label, phase: scheduled.phase } : null,
    timezone: settings.programTimezone,
    balances,
    earned,
    streak: streakAsOf(user, effectiveDateFor(new Date(), settings.programTimezone)),
    longestStreak: user.longestStreak,
    printer,
    cards,
  }
}
