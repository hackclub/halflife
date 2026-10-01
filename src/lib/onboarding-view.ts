import { type HardwareExperience, Theme } from "@/app/generated/prisma/enums"
import { EXPERIENCE_OPTIONS, isBeginner, ONBOARDING_STEPS, weekIntroFor } from "@/lib/config/onboarding"
import { THEMES } from "@/lib/config/program"
import { TIERS } from "@/lib/config/tiers"
import { WEEK_META } from "@/lib/curriculum"

/** A starter project as the client shows it: everything but which weeks it belongs to. */
export interface StarterProjectView {
	id: string
	title: string
	description: string
	parts: readonly string[]
	repoUrl: string
	guideUrl: string
}

export interface OnboardingStateData {
	reached: number
	stepCount: number
	completed: boolean
	experience: HardwareExperience | null
	suggestedTier: number
	project: {
		id: string
		title: string
		description: string | null
		requestedTier: number | null
		starterProjectId: string | null
		tierLocked: boolean
	}
	starterProjects: readonly StarterProjectView[]
	trackingDismissed: boolean
}

export interface OnboardingView {
	reached: number
	stepCount: number
	completed: boolean
	experience: HardwareExperience | null
	suggestedTier: number
	beginner: boolean
	/** The week-one project row, for the repo-sync step at the end of the flow. */
	projectId: string
	steps: readonly { id: string; number: number; heading: string; skippable: boolean }[]
	experienceOptions: readonly { value: HardwareExperience; label: string; hint: string }[]
	weekIntro: {
		/** The curriculum's name for the theme, which is what names its painting. */
		painting: string
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
	starterProjects: readonly StarterProjectView[]
	tiers: readonly {
		id: number
		name: string
		grantUsd: number
		estimate: string
		showcase: readonly { title: string; image: string; href: string }[]
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
		projectId: state.project.id,
		steps: ONBOARDING_STEPS.map((step) => ({ ...step })),
		experienceOptions: EXPERIENCE_OPTIONS,
		weekIntro: intro
			? {
					painting: WEEK_META[THEMES.findIndex((t) => t.id === intro.theme)]?.theme ?? "",
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
			parts: [...p.parts],
			repoUrl: p.repoUrl,
			guideUrl: p.guideUrl,
		})),
		tiers: TIERS.map((tier) => ({
			id: tier.id,
			name: tier.name,
			grantUsd: tier.grantUsd,
			estimate: tier.estimate,
			showcase: [...(tier.showcase[Theme.PCB] ?? [])],
		})),
	}
}
