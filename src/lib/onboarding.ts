import "server-only"
import prisma from "@/lib/prisma"
import { HardwareExperience, PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import { HttpError } from "@/lib/errors"
import { sanitize, sanitizeHtml } from "@/lib/sanitize"
import { ensureThemeProject } from "@/lib/provisioning"
import { markProjectCreated } from "@/lib/analytics"
import { isTierId, type TierId } from "@/lib/config/tiers"
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_COUNT,
  STARTER_PROJECT_TIER,
  getStarterProject,
  starterProjectsFor,
  stepAt,
  stepIndexOf,
  suggestedTierFor,
  type OnboardingStep,
  type OnboardingStepId,
  type StarterProject,
} from "@/lib/config/onboarding"

/**
 * The first checkpoint's state machine.
 *
 * Two rules hold everything together:
 *
 * 1. `onboardingStep` is the furthest step REACHED, never the step being
 *    displayed. Answering step 3 again after reaching step 5 edits the answer
 *    and leaves the progress alone, so a participant can go back and change
 *    their project name without being walked through the tier question again.
 * 2. Nothing here writes `ThemeProject.tier`. The participant's choice lands
 *    in `requestedTier`; the reviewer's decision at design approval is a
 *    different column, and money is paid against theirs.
 */

/** The theme the first checkpoint runs against. The comp: "This is PCB week!" */
export const ONBOARDING_THEME: Theme = Theme.PCB

export interface OnboardingState {
  completed: boolean
  /** Furthest step reached, 0-based. */
  reached: number
  /** The step to show now. */
  current: OnboardingStep | null
  stepCount: number
  experience: HardwareExperience | null
  suggestedTier: TierId
  project: {
    id: string
    title: string
    description: string | null
    requestedTier: number | null
    starterProjectId: string | null
    /** Starter projects are Tier 1 work, so the choice is not the user's. */
    tierLocked: boolean
  }
  starterProjects: readonly StarterProject[]
  trackingDismissed: boolean
}

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  // Onboarding is week one's "create a project" checkpoint, so it is where the
  // PCB project comes into being — the only one it makes.
  await ensureThemeProject(userId, ONBOARDING_THEME)

  const [user, project] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        hardwareExperience: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        trackingTutorialDismissedAt: true,
      },
    }),
    prisma.themeProject.findFirstOrThrow({
      where: { userId, theme: ONBOARDING_THEME, deletedAt: null },
      select: {
        id: true,
        title: true,
        description: true,
        requestedTier: true,
        starterProjectId: true,
      },
    }),
  ])

  const reached = clampStep(user.onboardingStep)

  return {
    completed: user.onboardingCompletedAt !== null,
    reached,
    current: stepAt(reached) ?? null,
    stepCount: ONBOARDING_STEP_COUNT,
    experience: user.hardwareExperience,
    suggestedTier: suggestedTierFor(user.hardwareExperience),
    project: {
      ...project,
      tierLocked: project.starterProjectId !== null,
    },
    starterProjects: starterProjectsFor(ONBOARDING_THEME),
    trackingDismissed: user.trackingTutorialDismissedAt !== null,
  }
}

function clampStep(step: number): number {
  if (!Number.isFinite(step) || step < 0) return 0
  return Math.min(step, ONBOARDING_STEP_COUNT)
}

/** Answers, one shape per step. The route validates before this is reached. */
export type OnboardingAnswer =
  | { step: "experience"; experience: HardwareExperience }
  | { step: "week" }
  | { step: "project"; title: string; description: string }
  | { step: "idea"; starterProjectId: string | null }
  | { step: "tier"; requestedTier: number | null }
  | { step: "tracking"; dismissed: boolean }

export interface AdvanceResult {
  state: OnboardingState
  completed: boolean
}

/**
 * Record one step's answer and move the furthest-reached marker forward.
 *
 * Everything is one transaction because two of the steps write to two tables
 * at once (the project row and the progress marker), and a half-applied answer
 * strands someone on a step they have already completed.
 */
export async function submitStep(
  userId: string,
  answer: OnboardingAnswer,
): Promise<AdvanceResult> {
  const before = await getOnboardingState(userId)

  if (before.completed) {
    throw new HttpError("ALREADY_RESOLVED", "You have already finished getting started")
  }

  const index = stepIndexOf(answer.step)
  if (index === -1) throw new HttpError("VALIDATION_FAILED", "Unknown step")
  // Answering ahead of where you have got would let someone skip the questions
  // by posting the last step first.
  if (index > before.reached) {
    throw new HttpError("VALIDATION_FAILED", "Finish the earlier steps first")
  }

  const userData: {
    hardwareExperience?: HardwareExperience
    trackingTutorialDismissedAt?: Date
  } = {}
  const projectData: {
    title?: string
    description?: string
    requestedTier?: number | null
    starterProjectId?: string | null
  } = {}

  switch (answer.step) {
    case "experience":
      userData.hardwareExperience = answer.experience
      break

    case "week":
      // Purely informational — the PCB week explainer. Nothing to record
      // beyond having been through it.
      break

    case "project": {
      const title = sanitize(answer.title)
      if (!title) throw new HttpError("VALIDATION_FAILED", "Give your project a name")
      projectData.title = title
      projectData.description = sanitizeHtml(answer.description)
      // Writing your own description means you are no longer taking the
      // starter build, so the tier stops being locked to 1.
      projectData.starterProjectId = null
      break
    }

    case "idea": {
      if (answer.starterProjectId === null) {
        projectData.starterProjectId = null
        break
      }
      const starter = getStarterProject(answer.starterProjectId)
      if (!starter || starter.theme !== ONBOARDING_THEME) {
        throw new HttpError("VALIDATION_FAILED", "That is not one of the suggestions")
      }
      projectData.starterProjectId = starter.id
      projectData.title = starter.title
      projectData.description = starter.description
      // Taking a starter locks the request rather than merely defaulting it,
      // so the tier step has nothing to decide.
      projectData.requestedTier = STARTER_PROJECT_TIER
      break
    }

    case "tier": {
      if (answer.requestedTier === null) {
        // Only the locked case may decline to choose: its tier was already
        // written when the starter project was taken, so there is nothing
        // left to answer. Anyone else is trying to skip the question.
        if (!before.project.tierLocked) {
          throw new HttpError("VALIDATION_FAILED", "Pick one of the three tiers")
        }
        break
      }
      if (before.project.tierLocked) {
        throw new HttpError(
          "VALIDATION_FAILED",
          "Starter projects are Tier 1. Write your own project idea to choose a different tier.",
        )
      }
      if (!isTierId(answer.requestedTier)) {
        throw new HttpError("VALIDATION_FAILED", "Pick one of the three tiers")
      }
      projectData.requestedTier = answer.requestedTier
      break
    }

    case "tracking":
      if (answer.dismissed) userData.trackingTutorialDismissedAt = new Date()
      break
  }

  // Only ever forward: re-answering step 3 from step 5 must not rewind anyone.
  const reached = Math.max(before.reached, index + 1)
  const finishing = reached >= ONBOARDING_STEP_COUNT

  await prisma.$transaction(async (tx) => {
    if (Object.keys(projectData).length > 0) {
      await tx.themeProject.update({
        where: { id: before.project.id },
        data: projectData,
      })
    }
    await tx.user.update({
      where: { id: userId },
      data: {
        ...userData,
        onboardingStep: reached,
        ...(finishing ? { onboardingCompletedAt: new Date() } : {}),
      },
    })
  })

  if (Object.keys(projectData).length > 0) await markProjectCreated(before.project.id, userId)

  return { state: await getOnboardingState(userId), completed: finishing }
}

/**
 * Whether this participant should be sent through the first checkpoint.
 *
 * Anyone who has already started working is past it whatever the column says:
 * the flow was added after the platform, and walking an existing participant
 * through "make your first project" when they have three approved designs
 * would be absurd. The check is deliberately generous for that reason.
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingCompletedAt: true },
  })
  if (!user || user.onboardingCompletedAt) return false

  const started = await prisma.themeProject.count({
    where: {
      userId,
      deletedAt: null,
      OR: [
        { designStatus: { not: PhaseStatus.draft } },
        { buildStatus: { not: PhaseStatus.draft } },
        { workSessions: { some: { deletedAt: null } } },
      ],
    },
  })
  return started === 0
}

export { ONBOARDING_STEPS }
export type { OnboardingStepId }
