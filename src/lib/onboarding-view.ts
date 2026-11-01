import { z } from "zod"
import { EXPERIENCE_OPTIONS, isBeginner, ONBOARDING_STEPS, weekIntroFor } from "@/lib/config/onboarding"
import { THEMES } from "@/lib/config/program"
import { TIERS } from "@/lib/config/tiers"
import { WEEK_META } from "@/lib/curriculum"
import { type HardwareExperience, Theme } from "@/lib/enums"

/** A starter project as the client shows it: everything but which weeks it belongs to. */
export interface StarterProjectView {
	description: string
	guideUrl: string
	id: string
	parts: readonly string[]
	repoUrl?: string
	title: string
}

export interface OnboardingStateData {
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

export interface OnboardingView {
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
	} | null
}

/** The identity options HCA carries, as the client receives them. */
const HardwareExperienceSchema = z.enum(["A_GOOD_AMOUNT", "A_LITTLE", "FIRST_TIME", "ITS_LIFE"])

const StarterProjectViewSchema = z.object({
	description: z.string(),
	guideUrl: z.string(),
	id: z.string(),
	parts: z.array(z.string()),
	repoUrl: z.string().optional(),
	title: z.string(),
})

/**
 * The view the API returns to the flow and the dashboard modal, checked rather than trusted.
 *
 * The server builds it, so a mismatch is a drift between the two, and the failure is here rather than as an undefined heading three steps in. Typed as the interface above so the schema and the type cannot drift apart.
 */
export const OnboardingViewSchema: z.ZodType<OnboardingView> = z.object({
	beginner: z.boolean(),
	completed: z.boolean(),
	experience: HardwareExperienceSchema.nullable(),
	experienceOptions: z.array(z.object({ hint: z.string(), label: z.string(), value: HardwareExperienceSchema })),
	project: z.object({
		description: z.string(),
		requestedTier: z.number().nullable(),
		starterProjectId: z.string().nullable(),
		tierLocked: z.boolean(),
		title: z.string(),
	}),
	projectId: z.string(),
	reached: z.number(),
	starterProjects: z.array(StarterProjectViewSchema),
	stepCount: z.number(),
	steps: z.array(z.object({ heading: z.string(), id: z.string(), number: z.number(), skippable: z.boolean() })),
	suggestedTier: z.number(),
	tiers: z.array(
		z.object({
			estimate: z.string(),
			grantUsd: z.number(),
			id: z.number(),
			name: z.string(),
			showcase: z.array(z.object({ href: z.string(), image: z.string(), title: z.string() })),
		}),
	),
	weekIntro: z
		.object({
			headline: z.string(),
			kicker: z.string(),
			painting: z.string(),
			primer: z.string(),
		})
		.nullable(),
})

/** The route's answer: the view, or the error envelope a refusal carries. */
export const OnboardingResponseSchema = z.object({
	error: z.object({ message: z.string().optional() }).optional(),
	onboarding: OnboardingViewSchema.optional(),
})

/**
 * The API and the dashboard modal deliberately share this view model. The server remains authoritative for progress; the client only chooses which answered step to display.
 */
export function toOnboardingView(state: OnboardingStateData): OnboardingView {
	const themeIndex = THEMES.findIndex(t => t.id === state.theme)
	const meta = WEEK_META[themeIndex]
	const custom = weekIntroFor(state.theme)
	// The curriculum's own copy for the theme, with week one's shorter intro kept where it has one. A late joiner onboarded into Music gets Music's primer and painting rather than PCB's.
	const intro = meta
		? {
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
		weekIntro: intro,
	}
}
