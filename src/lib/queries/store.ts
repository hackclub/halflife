import "server-only"
import prisma from "@/lib/prisma"
import { HardwareExperience, Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { getBalances } from "@/lib/currency"
import { getProgramSettings, effectiveDateFor, weekNumberForDate } from "@/lib/program"
import { streakAsOf } from "@/lib/streak"
import { rollUpHours } from "@/lib/hours"
import { DEFAULT_GOAL_ID } from "@/lib/config/printers"
import { DESIGN_WEEKS, ONBOARDING_CHECKPOINT_ID, THEMES } from "@/lib/config/program"
import type { Experience, Project, SessionLog } from "@/lib/types"

/**
 * Everything the trail needs, read out of the database in one pass.
 *
 * ## The seam
 *
 * The platform UI derives its entire shape — how many nodes a week has, where
 * the progress reels fall, which one is live, what is locked and why — from one
 * record of checkpoint states, through `curriculum.checkpointsFor`. That
 * function is pure and already agrees with the program design, so the server's
 * only job is to say which checkpoints are done and with what, and let the
 * client derive the rest exactly as it did when the data was a toy.
 *
 * This is why the wedding is small. The alternative was a second checkpoint
 * engine on the server, and the first time the two disagreed the trail would
 * have lied to someone about work they had really done.
 *
 * ## What is NOT here
 *
 * The cinematic, the spotlight, the tab tour, and whether the Doomscroller rail
 * is open. Those are ceremony, they are per-device, and nobody else ever needs
 * to read them, so they stay in `localStorage` where a new laptop replays the
 * intro rather than inheriting a half-finished one. The server owns facts; the
 * browser owns ceremony.
 */

/** One checkpoint's state, in the shape the client store keeps them. */
export interface CheckpointSnapshot {
  done: boolean
  at?: number
  caption?: string
  minutes: number
  artefacts: number
  log: SessionLog[]
}

export interface StoreSnapshot {
  /** Who is signed in. Display fields only — never an email or a Slack id. */
  viewer: { name: string; image: string | null; joinedWeek: number | null }
  experience: Experience | null
  /** Whether the first checkpoint has been completed. */
  onboardingDone: boolean
  projects: Project[]
  /**
   * Every theme project's id, by the design week it belongs to — including the
   * ones nobody has named yet.
   *
   * The five rows exist from signup, so "creating" a project on the trail is
   * really naming one. `projects` deliberately leaves the unnamed ones out, or
   * the trail would claim credit for four weeks that have not happened, which
   * means the client would have no id to write to when a week finally starts.
   */
  projectIdByWeek: Record<number, string>
  progress: Record<string, CheckpointSnapshot>
  /**
   * Hours a week has that did NOT come from its journal entries — Hackatime
   * link time, and reviewer adjustments to it.
   *
   * Kept apart from the entries rather than folded into them because the two
   * are used for different things. Reels are placed where the JOURNAL crossed
   * ten hours, so that placement has to follow entries and nothing else; the
   * gates ask what the week is really worth, which is everything. Folding
   * Hackatime into an entry would move a reel to a node the participant never
   * wrote.
   */
  offBookHours: Record<number, number>
  /**
   * Where each week's phase stands with review, by trail week.
   *
   * Coins are minted when a reviewer approves a phase, not when hours are
   * logged, so the balance below trails the work by a review. Anything that
   * asks "is this week on pace" has to add back what the unreviewed weeks will
   * bank — and to know which weeks those are, it needs this.
   */
  phaseStatusByWeek: Record<number, PhaseStatus>
  /** Ordinary coins. */
  coins: number
  /** The printer fund. Spendable on a printer and nothing else. */
  bankedCoins: number
  streak: number
  goalId: string
}

const EXPERIENCE: Record<HardwareExperience, Experience> = {
  [HardwareExperience.FIRST_TIME]: "first",
  [HardwareExperience.A_LITTLE]: "little",
  [HardwareExperience.A_GOOD_AMOUNT]: "some",
  [HardwareExperience.ITS_LIFE]: "lots",
}

/** The program week a theme's phase is lived in. */
function weekOf(themeIndex: number, phase: Phase): number {
  return phase === Phase.DESIGN ? themeIndex + 1 : themeIndex + 1 + DESIGN_WEEKS
}

export async function getStoreSnapshot(userId: string): Promise<StoreSnapshot> {
  const [user, projects, sessions, links, posts, submissions, balances, settings] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          name: true,
          image: true,
          joinedProgramAt: true,
          hardwareExperience: true,
          onboardingCompletedAt: true,
          printerGoalId: true,
          currentStreak: true,
          lastStreakDate: true,
        },
      }),
      prisma.themeProject.findMany({
        where: { userId, deletedAt: null },
        select: {
          id: true,
          theme: true,
          title: true,
          description: true,
          tier: true,
          requestedTier: true,
          starterProjectId: true,
          githubRepo: true,
          designStatus: true,
          buildStatus: true,
          designApprovedHours: true,
          approvedHours: true,
        },
      }),
      // Ordered, because the trail's Nth entry node IS the Nth session written.
      prisma.workSession.findMany({
        where: { themeProject: { userId, deletedAt: null }, deletedAt: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          themeProjectId: true,
          phase: true,
          content: true,
          title: true,
          hoursClaimed: true,
          hoursApproved: true,
          hoursSource: true,
          createdAt: true,
          media: { select: { objectKey: true } },
          timelapses: { select: { objectKey: true, externalId: true } },
        },
      }),
      prisma.hackatimeLink.findMany({
        where: { themeProject: { userId, deletedAt: null } },
        select: { themeProjectId: true, phase: true, hoursApproved: true, cachedSeconds: true },
      }),
      prisma.post.findMany({
        where: { userId, deletedAt: null, checkpointKey: { not: null } },
        orderBy: { createdAt: "asc" },
        select: { checkpointKey: true, caption: true, createdAt: true },
      }),
      prisma.phaseSubmission.findMany({
        where: { themeProject: { userId, deletedAt: null } },
        orderBy: { createdAt: "asc" },
        select: { themeProjectId: true, phase: true, createdAt: true },
      }),
      prisma.$transaction((tx) => getBalances(tx, userId)),
      getProgramSettings(),
    ])

  const byTheme = new Map(projects.map((p) => [p.theme, p]))
  const progress: Record<string, CheckpointSnapshot> = {}
  const offBookHours: Record<number, number> = {}
  const phaseStatusByWeek: Record<number, PhaseStatus> = {}

  // A reel posted twice for the same node keeps the newest caption; the rows are
  // ordered oldest-first, so the last write through this loop is the newest.
  for (const post of posts) {
    if (!post.checkpointKey) continue
    progress[post.checkpointKey] = {
      done: true,
      at: post.createdAt.getTime(),
      caption: post.caption,
      minutes: 0,
      artefacts: 1,
      log: [],
    }
  }

  if (user.onboardingCompletedAt) {
    progress[ONBOARDING_CHECKPOINT_ID] = {
      done: true,
      at: user.onboardingCompletedAt.getTime(),
      minutes: 0,
      artefacts: 0,
      log: [],
    }
  }

  THEMES.forEach((theme, themeIndex) => {
    const project = byTheme.get(theme.id)
    if (!project) return

    for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
      const week = weekOf(themeIndex, phase)
      const id = (suffix: string) => `w${week}-${suffix}`

      const phaseSessions = sessions.filter(
        (s) => s.themeProjectId === project.id && s.phase === phase,
      )
      const phaseLinks = links.filter(
        (l) => l.themeProjectId === project.id && l.phase === phase,
      )

      // Week one's project comes into existence through the first checkpoint
      // rather than a project form, so the node that stands for it is different
      // and is already recorded above.
      if (phase === Phase.DESIGN && week !== 1) {
        const tier = project.tier ?? project.requestedTier
        if (project.title && project.description && tier) {
          progress[id("project")] = {
            done: true,
            minutes: 0,
            artefacts: 0,
            log: [],
          }
        }
      }

      phaseSessions.forEach((session, index) => {
        progress[id(`entry-${index + 1}`)] = {
          done: true,
          at: session.createdAt.getTime(),
          minutes: minutesOf(session),
          artefacts: session.media.length,
          log: [
            {
              id: session.id,
              minutes: minutesOf(session),
              body: session.content ?? session.title,
              at: session.createdAt.getTime(),
              clips: session.timelapses.flatMap((t) => {
                const ref = t.externalId ?? t.objectKey
                return ref ? [ref] : []
              }),
            },
          ],
        }
      })

      const submission = submissions.find(
        (s) => s.themeProjectId === project.id && s.phase === phase,
      )
      const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
      phaseStatusByWeek[week] = status
      if (submission || status !== PhaseStatus.draft) {
        progress[id("submit")] = {
          done: true,
          at: submission?.createdAt.getTime(),
          minutes: 0,
          artefacts: 0,
          log: [],
        }
      }

      // What the phase is worth, minus what its entries already account for.
      // `rollUpHours` is the function the ledger uses, so the trail's gates and
      // the reviewer's totals cannot answer this differently.
      const frozen =
        phase === Phase.DESIGN ? project.designApprovedHours : project.approvedHours
      const { effectiveHours } = rollUpHours(phaseSessions, phaseLinks, frozen)
      const entryHours = phaseSessions.reduce((n, s) => n + minutesOf(s) / 60, 0)
      offBookHours[week] = Math.max(0, round2(effectiveHours - entryHours))
    }
  })

  const projectIdByWeek: Record<number, string> = {}
  for (const project of projects) {
    const themeIndex = THEMES.findIndex((t) => t.id === project.theme)
    if (themeIndex !== -1) projectIdByWeek[weekOf(themeIndex, Phase.DESIGN)] = project.id
  }

  return {
    viewer: {
      name: user.name ?? "You",
      image: user.image,
      joinedWeek: user.joinedProgramAt
        ? weekNumberForDate(settings.eventStartDate, user.joinedProgramAt)
        : null,
    },
    experience: user.hardwareExperience ? EXPERIENCE[user.hardwareExperience] : null,
    onboardingDone: user.onboardingCompletedAt !== null,
    projects: projects.flatMap((project) => {
      const themeIndex = THEMES.findIndex((t) => t.id === project.theme)
      const tier = project.tier ?? project.requestedTier
      // A project nobody has named yet is not one the trail should list: the
      // five rows exist from signup, and showing them all would claim credit
      // for four weeks that have not happened.
      if (themeIndex === -1 || !project.title || !tier) return []
      return [
        {
          id: project.id,
          name: project.title,
          description: project.description ?? "",
          weekId: weekOf(themeIndex, Phase.DESIGN),
          tier: clampTier(tier),
          starter: project.starterProjectId !== null,
          githubRepo: project.githubRepo,
        },
      ]
    }),
    projectIdByWeek,
    progress,
    offBookHours,
    phaseStatusByWeek,
    coins: balances.spendable,
    bankedCoins: balances.banked,
    streak: streakAsOf(user, effectiveDateFor(new Date(), settings.programTimezone)),
    goalId: user.printerGoalId ?? DEFAULT_GOAL_ID,
  }
}

interface SessionRow {
  hoursClaimed: number
  hoursApproved: number | null
}

/** What a reviewer accepted, falling back to what was claimed. */
function minutesOf(session: SessionRow): number {
  return Math.round((session.hoursApproved ?? session.hoursClaimed) * 60)
}

function clampTier(tier: number): 1 | 2 | 3 {
  return tier === 2 || tier === 3 ? tier : 1
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
