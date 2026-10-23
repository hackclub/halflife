import { type HardwareExperience, Theme } from "@/app/generated/prisma/enums"
import { EXPERIENCE_OPTIONS, isBeginner, ONBOARDING_STEPS, weekIntroFor } from "@/lib/config/onboarding"
import { THEMES } from "@/lib/config/program"
import { TIERS } from "@/lib/config/tiers"
import { WEEK_META } from "@/lib/curriculum"

/** A starter project as the client shows it: everything but which weeks it belongs to. */
interface StarterProjectView {
	description: string
	guideUrl: string
	id: string
	parts: readonly string[]
	repoUrl: string
	title: string
}

interface OnboardingStateData {
	completed: boolean
	experience: HardwareExperience | null
	project: {
		id: string
		title: string
		description: string | null
		requestedTier: number | null
		starterProjectId: string | null
		tierLocked: boolean
	}
	reached: number
	starterProjects: readonly StarterProjectView[]
	stepCount: number
	suggestedTier: number
	/** The theme this participant is onboarding into. */
	theme: Theme
	trackingDismissed: boolean
}

interface OnboardingView {
	beginner: boolean
	completed: boolean
	experience: HardwareExperience | null
	experienceOptions: readonly { value: HardwareExperience; label: string; hint: string }[]
	project: {
		title: string
		description: string
		requestedTier: number | null
		starterProjectId: string | null
		tierLocked: boolean
	}
	/** The week-one project row, for the repo-sync step at the end of the flow. */
	projectId: string
	reached: number
	starterProjects: readonly StarterProjectView[]
	stepCount: number
	steps: readonly { id: string; number: number; heading: string; skippable: boolean }[]
	suggestedTier: number
	tiers: readonly {
		id: number
		name: string
		grantUsd: number
		estimate: string
		showcase: readonly { title: string; image: string; href: string }[]
	}[]
	weekIntro: {
		/** The curriculum's name for the theme, which is what names its painting. */
		painting: string
		kicker: string
		headline: string
		primer: string
		examples: readonly string[]
	} | null
}

/**
 * The API and the dashboard modal deliberately share this view model. The server remains authoritative for progress; the client only chooses which answered step to display.
 */
function toOnboardingView(state: OnboardingStateData): OnboardingView {
	const themeIndex = THEMES.findIndex(t => t.id === state.theme)
	const meta = WEEK_META[themeIndex]
	const custom = weekIntroFor(state.theme)
	// The curriculum's own copy for the theme, with week one's shorter intro kept where it has one. A late joiner onboarded into Music gets Music's primer, examples and painting rather than PCB's.
	const intro = meta
		? {
				examples: [...(custom?.examples ?? meta.examples)],
				headline: custom?.headline ?? meta.headline,
				kicker: custom?.kicker ?? meta.fullName,
				painting: meta.theme,
				primer: custom?.primer ?? meta.primer,
			}
		: null

	return {
		beginner: isBeginner(state.experience),
		completed: state.completed,
		experience: state.experience,
		experienceOptions: EXPERIENCE_OPTIONS,
		project: {
			description: state.project.description ?? "",
			requestedTier: state.project.requestedTier,
			starterProjectId: state.project.starterProjectId,
			tierLocked: state.project.tierLocked,
			title: state.project.title,
		},
		projectId: state.project.id,
		reached: state.reached,
		starterProjects: state.starterProjects.map(p => ({
			description: p.description,
			guideUrl: p.guideUrl,
			id: p.id,
			parts: [...p.parts],
			repoUrl: p.repoUrl,
			title: p.title,
		})),
		stepCount: state.stepCount,
		steps: ONBOARDING_STEPS.map(step => Object.assign({}, step)),
		suggestedTier: state.suggestedTier,
		tiers: TIERS.map(tier => ({
			estimate: tier.estimate,
			grantUsd: tier.grantUsd,
			id: tier.id,
			name: tier.name,
			showcase: [...(tier.showcase[Theme.PCB] ?? [])],
		})),
		weekIntro: intro ? { ...intro, examples: [...intro.examples] } : null,
	}
}

export { type OnboardingStateData, type OnboardingView, type StarterProjectView, toOnboardingView }
