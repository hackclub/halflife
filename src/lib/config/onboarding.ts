import { HardwareExperience, Theme } from "@/app/generated/prisma/enums"
import type { TierId } from "@/lib/config/tiers"

/**
 * The first checkpoint.
 *
 * The comp calls this "GETTING STARTED: n/6" and the design file's own note
 * spells out the sequence:
 *
 *   ask about hardware experience (will highlight appropriate funding tier
 *   when the choice shows up) / This is PCB week! If beginner: information
 *   about PCBs, else: example projects / Ask for project idea. Not sure? Pick
 *   from these options! / show tiers of funding, prompt to select (make clear
 *   this can be changed later) (if chose starter project then lock choice at
 *   tier 1) / journaling/lapse onboarding (option in corner to dismiss if
 *   you've journaled before) / exits out of first checkpoint
 *
 * It is the first of a larger per-week checkpoint system in the same note
 * (idea reel, progress reel, submission checks). Only this one is built; the
 * rest needs the feed first, since every later checkpoint is a reel.
 */

export type OnboardingStepId = "experience" | "week" | "project" | "idea" | "tier" | "tracking" | "repo"

export interface OnboardingStep {
	readonly id: OnboardingStepId
	/** 1-based, and what renders as the "n/6" counter. */
	readonly number: number
	readonly heading: string
	/** True when the participant may move past it without answering. */
	readonly skippable: boolean
}

export const ONBOARDING_STEPS = [
	{ id: "experience", number: 1, heading: "Have you built hardware before?", skippable: false },
	{ id: "week", number: 2, heading: "Each week has a theme, this week it's...", skippable: false },
	{ id: "project", number: 3, heading: "Make your first project!", skippable: false },
	{ id: "idea", number: 4, heading: "Stuck? Pick one of the following:", skippable: true },
	{ id: "tier", number: 5, heading: "Choose a Tier", skippable: false },
	{ id: "tracking", number: 6, heading: "Time Tracking", skippable: true },
	// Optional and last: the sync is a convenience, not a step of making a
	// project, and putting it before time tracking would make it read as one.
	// Skippable, because plenty of people have no repo yet.
	{ id: "repo", number: 7, heading: "Keep it in your repo?", skippable: true },
] as const satisfies readonly OnboardingStep[]

export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length

/** The step a participant is on, given how far they have got. */
export function stepAt(index: number): OnboardingStep | undefined {
	return ONBOARDING_STEPS[index]
}

export function stepIndexOf(id: OnboardingStepId): number {
	return ONBOARDING_STEPS.findIndex((s) => s.id === id)
}

/**
 * Which tier to highlight, from the answer to question one.
 *
 * A suggestion in the UI and nothing more – the participant can pick any tier,
 * and the reviewer decides the real one at design approval. Someone who has
 * never touched hardware being shown Tier 3 first is the thing this avoids.
 */
export function suggestedTierFor(experience: HardwareExperience | null): TierId {
	switch (experience) {
		case HardwareExperience.ITS_LIFE:
			return 3
		case HardwareExperience.A_GOOD_AMOUNT:
			return 2
		default:
			return 1
	}
}

export const EXPERIENCE_OPTIONS = [
	{
		value: HardwareExperience.FIRST_TIME,
		label: "this is my first time!",
		hint: "Day 1 or 1 Day, you know?",
	},
	{
		value: HardwareExperience.A_LITTLE,
		label: "just a little...",
		hint: "Messed around with breadboards, maybe a blinking LED.",
	},
	{
		value: HardwareExperience.A_GOOD_AMOUNT,
		label: "yeah, I've built a good amount",
		hint: "You've shipped a project that works.",
	},
	{
		value: HardwareExperience.ITS_LIFE,
		label: "call me the hardware wizard",
		hint: "You've built a lot of projects, from PCBs to 3D prints.",
	},
] as const

/**
 * Starter projects: a real, finished build with a step-by-step guide, offered
 * to anyone who said they are new to hardware (see `seesStarterProjects`).
 *
 * Taking one locks the tier request to 1, so these have to be genuinely Tier 1
 * in scope. Each week is meant to get its own; until those repos exist,
 * Starbie, week one's, stands in for every theme.
 */
export interface StarterProject {
	readonly id: string
	/** The weeks it is offered in. */
	readonly themes: readonly Theme[]
	readonly title: string
	readonly description: string
	/** What goes on the board, for the card's parts line. */
	readonly parts: readonly string[]
	readonly repoUrl: string
	readonly guideUrl: string
}

const ALL_THEMES = [Theme.PCB, Theme.CAD, Theme.SYNTH, Theme.DISPLAYS, Theme.BREADBOARD_COMPUTER] as const

export const STARTER_PROJECTS = [
	{
		id: "starbie",
		// Week one's starter, in every week until each has its own repo.
		themes: ALL_THEMES,
		title: "Starbie",
		// The project's own README, trimmed.
		description: "A tiny motion-controlled digital pet, basically a desktop Tamagotchi. Totally not a Starboy.",
		parts: ["XIAO ESP32-C3", "OLED screen", "MPU6050 motion sensor", "DHT11 sensor"],
		repoUrl: "https://github.com/SharKingStudios/Starbie",
		guideUrl: "https://github.com/SharKingStudios/Starbie/blob/main/Week%201%20Guide.md",
	},
] as const satisfies readonly StarterProject[]

export function starterProjectsFor(theme: Theme): readonly StarterProject[] {
	return STARTER_PROJECTS.filter((p) => (p.themes as readonly Theme[]).includes(theme))
}

/**
 * Who is shown starter projects: the two answers that mean new to hardware.
 * Unlike `isBeginner`, no answer is not a yes; someone who never answered did
 * not say they were new.
 */
export function seesStarterProjects(experience: HardwareExperience | null): boolean {
	return experience === HardwareExperience.FIRST_TIME || experience === HardwareExperience.A_LITTLE
}

export function getStarterProject(id: string): StarterProject | undefined {
	return STARTER_PROJECTS.find((p) => p.id === id)
}

/** The tier a starter project is scoped to. Not configurable – see above. */
export const STARTER_PROJECT_TIER: TierId = 1

/**
 * Step two's copy: "Each week will have a theme, this week it's..."
 *
 * The comp branches this on the answer to question one – "If beginner:
 * information about PCBs, else: example projects" – so both halves are here
 * and the step picks one.
 */
export interface WeekIntro {
	readonly theme: Theme
	readonly kicker: string
	readonly headline: string
	/** Shown to FIRST_TIME and A_LITTLE. */
	readonly primer: string
	/** Shown to everyone else, in place of the primer. */
	readonly examples: readonly string[]
}

export const WEEK_INTROS = [
	{
		theme: Theme.PCB,
		kicker: "Printed Circuit Board Week",
		headline: "DESIGN YOUR PCB",
		primer:
			"A printed circuit board is a sheet of fibreglass with copper traces etched into it, so components solder straight onto the board instead of being wired by hand.",
		examples: ["A PCB keychain!", "A flight controller!", "A devboard from your favorite microcontroller!"],
	},
] as const satisfies readonly WeekIntro[]

export function weekIntroFor(theme: Theme): WeekIntro | undefined {
	return WEEK_INTROS.find((w) => w.theme === theme)
}

/** Whether step two should show the primer rather than the examples. */
export function isBeginner(experience: HardwareExperience | null): boolean {
	return (
		experience === HardwareExperience.FIRST_TIME || experience === HardwareExperience.A_LITTLE || experience === null
	)
}
