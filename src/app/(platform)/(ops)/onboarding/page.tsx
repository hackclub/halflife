import { redirect } from "next/navigation"
import { requireSessionPage } from "@/lib/page-guards"
import { getOnboardingState, ONBOARDING_THEME } from "@/lib/onboarding"
import { EXPERIENCE_OPTIONS, ONBOARDING_STEPS, isBeginner, weekIntroFor } from "@/lib/config/onboarding"
import { submitFloorFor } from "@/lib/config/printers"
import { TIERS } from "@/lib/config/tiers"
import { PageHeader } from "@/app/components/ui"
import { OnboardingFlow, type OnboardingView } from "@/app/components/forms/OnboardingFlow"

export const dynamic = "force-dynamic"

export default async function OnboardingPage() {
  const { user } = await requireSessionPage()
  const state = await getOnboardingState(user.id)

  // Finishing is one-way. Someone who lands back here after completing it gets
  // the dashboard rather than a flow that would refuse every answer.
  if (state.completed) redirect("/dashboard")

  const intro = weekIntroFor(ONBOARDING_THEME)

  const view: OnboardingView = {
    reached: state.reached,
    stepCount: state.stepCount,
    completed: state.completed,
    experience: state.experience,
    suggestedTier: state.suggestedTier,
    beginner: isBeginner(state.experience),
    steps: ONBOARDING_STEPS.map((s) => ({
      id: s.id,
      number: s.number,
      heading: s.heading,
      skippable: s.skippable,
    })),
    experienceOptions: EXPERIENCE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
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
    starterProjects: state.starterProjects.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
    })),
    tiers: TIERS.map((t) => ({
      id: t.id,
      name: t.name,
      grantUsd: t.grantUsd,
      fundingHours: t.fundingHours,
      submitFloorHours: submitFloorFor(t.fundingHours),
      blurb: t.blurb,
    })),
  }

  return (
    <div className="hl-stack">
      <PageHeader
        title="Getting started"
        subtitle="Five questions and a tour. You can change any of these answers later."
      />
      <OnboardingFlow initial={view} />
    </div>
  )
}
