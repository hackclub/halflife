import { type HardwareExperience, Theme } from "@/app/generated/prisma/enums"
import { EXPERIENCE_OPTIONS, isBeginner, ONBOARDING_STEPS, weekIntroFor } from "@/lib/config/onboarding"
import { submitFloorFor } from "@/lib/config/printers"
import { TIERS } from "@/lib/config/tiers"

export interface OnboardingStateData {
  reached: number
  stepCount: number
  completed: boolean
  experience: HardwareExperience | null
  suggestedTier: number
  project: {
    title: string
    description: string | null
    requestedTier: number | null
    starterProjectId: string | null
    tierLocked: boolean
  }
  starterProjects: readonly { id: string; title: string; description: string }[]
  trackingDismissed: boolean
}

export interface OnboardingView {
  reached: number
  stepCount: number
  completed: boolean
  experience: HardwareExperience | null
  suggestedTier: number
  beginner: boolean
  steps: readonly { id: string; number: number; heading: string; skippable: boolean }[]
  experienceOptions: readonly { value: HardwareExperience; label: string }[]
  weekIntro: {
    kicker: string
    headline: string
    primer: string
    examples: readonly string[]
  } | null
  project: {
    title: string
    description: string
    requestedTier: number | null
    starterProjectId: string | null
    tierLocked: boolean
  }
  starterProjects: readonly { id: string; title: string; description: string }[]
  tiers: readonly {
    id: number
    name: string
    grantUsd: number
    fundingHours: number
    submitFloorHours: number
    blurb: string
  }[]
}

/**
 * The API and the dashboard modal deliberately share this view model. The
 * server remains authoritative for progress; the client only chooses which
 * answered step to display.
 */
export function toOnboardingView(state: OnboardingStateData): OnboardingView {
  const intro = weekIntroFor(Theme.PCB)

  return {
    reached: state.reached,
    stepCount: state.stepCount,
    completed: state.completed,
    experience: state.experience,
    suggestedTier: state.suggestedTier,
    beginner: isBeginner(state.experience),
    steps: ONBOARDING_STEPS.map((step) => ({ ...step })),
    experienceOptions: EXPERIENCE_OPTIONS,
    weekIntro: intro
      ? {
          kicker: intro.kicker,
          headline: intro.headline,
          primer: intro.primer,
          examples: [...intro.examples],
        }
      : null,
    project: {
      title: state.project.title,
      description: state.project.description ?? "",
      requestedTier: state.project.requestedTier,
      starterProjectId: state.project.starterProjectId,
      tierLocked: state.project.tierLocked,
    },
    starterProjects: state.starterProjects.map((project) => ({ ...project })),
    tiers: TIERS.map((tier) => ({
      id: tier.id,
      name: tier.name,
      grantUsd: tier.grantUsd,
      fundingHours: tier.fundingHours,
      submitFloorHours: submitFloorFor(tier.fundingHours),
      blurb: tier.blurb,
    })),
  }
}
