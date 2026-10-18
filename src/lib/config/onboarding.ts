import { HardwareExperience, Theme } from "@/app/generated/prisma/enums"
import type { TierId } from "@/lib/config/tiers"

/**
 * The first checkpoint.
 *
 * The comp calls this "GETTING STARTED: n/6" and the design file's own note spells out the sequence:
 *
 * ask about hardware experience (will highlight appropriate funding tier when the choice shows up) / This is PCB week! If beginner: information about PCBs, else: example projects / Ask for project idea. Not sure? Pick from these options! / show tiers of funding, prompt to select (make clear this can be changed later) (if chose starter project then lock choice at tier 1) / journaling/lapse onboarding (option in corner to dismiss if you've journaled before) / exits out of first checkpoint
 *
 * It is the first of a larger per-week checkpoint system in the same note (idea reel, progress reel, submission checks). Only this one is built; the rest needs the feed first, since every later checkpoint is a reel.
 */

export type OnboardingStepId = "experience" | "week" | "project" | "idea" | "tier" | "tracking" | "repo"

export interface OnboardingStep {
	readonly heading: string
	readonly id: OnboardingStepId
	/** 1-based, and what renders as the "n/6" counter. */
	readonly number: number
	/** True when the participant may move past it without answering. */
	readonly skippable: boolean
}

export const ONBOARDING_STEPS = [
	{ heading: "Have you built hardware before?", id: "experience", number: 1, skippable: false },
	{ heading: "Each week has a theme, this week it's...", id: "week", number: 2, skippable: false },
	{ heading: "Make your first project!", id: "project", number: 3, skippable: false },
	{ heading: "Stuck? Pick one of the following:", id: "idea", number: 4, skippable: true },
	{ heading: "Choose a Tier", id: "tier", number: 5, skippable: false },
	{ heading: "Time Tracking", id: "tracking", number: 6, skippable: true },
	// Optional and last: the sync is a convenience, not a step of making a project, and putting it before time tracking would make it read as one. Skippable, because plenty of people have no repo yet.
	{ heading: "Keep it in your repo?", id: "repo", number: 7, skippable: true },
] as const satisfies readonly OnboardingStep[]

export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length

/** The step a participant is on, given how far they have got. */
export function stepAt(index: number): OnboardingStep | undefined {
	return ONBOARDING_STEPS[index]
}

export function stepIndexOf(id: OnboardingStepId): number {
	return ONBOARDING_STEPS.findIndex(s => s.id === id)
}

/**
 * Which tier to highlight, from the answer to question one.
 *
 * A suggestion in the UI and nothing more – the participant can pick any tier, and the reviewer decides the real one at design approval. Someone who has never touched hardware being shown Tier 3 first is the thing this avoids.
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
		hint: "Day 1 or 1 Day, you know?",
		label: "this is my first time!",
		value: HardwareExperience.FIRST_TIME,
	},
	{
		hint: "Messed around with breadboards, maybe a blinking LED.",
		label: "just a little...",
		value: HardwareExperience.A_LITTLE,
	},
	{
		hint: "You've shipped a project that works.",
		label: "yeah, I've built a good amount",
		value: HardwareExperience.A_GOOD_AMOUNT,
	},
	{
		hint: "You've built a lot of projects, from PCBs to 3D prints.",
		label: "call me the hardware wizard",
		value: HardwareExperience.ITS_LIFE,
	},
] as const

/**
 * Starter projects: a real, finished build with a step-by-step guide, offered to anyone who said they are new to hardware (see `seesStarterProjects`).
 *
 * Taking one locks the tier request to 1, so these have to be genuinely Tier 1 in scope. Each week is meant to get its own; until those repos exist, Starbie, week one's, stands in for every theme without one.
 */
export interface StarterProject {
	readonly description: string
	readonly guideUrl: string
	readonly id: string
	/** What goes on the board, for the card's parts line. */
	readonly parts: readonly string[]
	readonly repoUrl: string
	/** The weeks it is offered in. */
	readonly themes: readonly Theme[]
	readonly title: string
}

export const STARTER_PROJECTS = [
	{
		// The project's own README, trimmed.
		description: "A tiny motion-controlled digital pet, basically a desktop Tamagotchi. Totally not a Starboy.",
		guideUrl: "https://github.com/SharKingStudios/Starbie/blob/main/Week%201%20Guide.md",
		id: "starbie",
		parts: ["XIAO ESP32-C3", "OLED screen", "MPU6050 motion sensor", "DHT11 sensor"],
		repoUrl: "https://github.com/SharKingStudios/Starbie",
		// Week one's starter, in every week until each has its own repo.
		themes: [Theme.PCB, Theme.DISPLAYS, Theme.BREADBOARD_COMPUTER],
		title: "Starbie",
	},
	{
		// The repo has no README; this is the guide's own summary.
		description:
			"A custom 3D-printed marble race, designed from scratch! You'll learn how to design your own course and make cool tracks.",
		guideUrl: "https://github.com/karnxx/merbl/blob/main/guide.md",
		id: "merbl",
		parts: ["3D printed track"],
		repoUrl: "https://github.com/karnxx/merbl",
		themes: [Theme.CAD],
		title: "Merbl run",
	},
	{
		// The repo's own description; the README is the guide.
		description:
			"Learn PCB design by creating your own custom MIDI keypad with switches, sliders, rotary encoders, neopixels and capacitive touch!",
		guideUrl: "https://github.com/KaiPereira/MIDI-Keypad/blob/master/README.md",
		id: "midi",
		parts: ["ESP32-S3-Zero", "Kailh Choc switches", "Slide potentiometers", "EC11 rotary encoder", "SK6812 neopixels"],
		repoUrl: "https://github.com/KaiPereira/MIDI-Keypad",
		themes: [Theme.SYNTH],
		title: "Midi Keyboard",
	},
] as const satisfies readonly StarterProject[]

export function starterProjectsFor(theme: Theme): readonly StarterProject[] {
	return STARTER_PROJECTS.filter(p => (p.themes as readonly Theme[]).includes(theme))
}

/**
 * Who is shown starter projects: the two answers that mean new to hardware. Unlike `isBeginner`, no answer is not a yes; someone who never answered did not say they were new.
 */
export function seesStarterProjects(experience: HardwareExperience | null): boolean {
	return experience === HardwareExperience.FIRST_TIME || experience === HardwareExperience.A_LITTLE
}

export function getStarterProject(id: string): StarterProject | undefined {
	return STARTER_PROJECTS.find(p => p.id === id)
}

/** The tier a starter project is scoped to. Not configurable – see above. */
export const STARTER_PROJECT_TIER: TierId = 1

/**
 * What a starter has to become before it can be handed in.
 *
 * The guide is a starting point, not a submission, and "how much do I have to change?" comes up every cohort. Said
 * once here so the two onboarding steps that offer a starter cannot drift apart in how they answer it.
 */
export const STARTER_MODIFICATION_NOTE =
	"A starter is a starting point, not the finished project. Make it yours – it needs enough of your own changes, to the design or the code, that the result is clearly unique to you. Handing in the guide's build with only small tweaks is not enough."

/**
 * Step two's copy: "Each week will have a theme, this week it's..."
 *
 * The comp branches this on the answer to question one – "If beginner: information about PCBs, else: example projects" – so both halves are here and the step picks one.
 */
export interface WeekIntro {
	/** Shown to everyone else, in place of the primer. */
	readonly examples: readonly string[]
	readonly headline: string
	readonly kicker: string
	/** Shown to FIRST_TIME and A_LITTLE. */
	readonly primer: string
	readonly theme: Theme
}

export const WEEK_INTROS = [
	{
		examples: ["A PCB keychain!", "A flight controller!", "A devboard from your favorite microcontroller!"],
		headline: "DESIGN YOUR PCB",
		kicker: "Printed Circuit Board Week",
		primer:
			"A printed circuit board is a sheet of fibreglass with copper traces etched into it, so components solder straight onto the board instead of being wired by hand.",
		theme: Theme.PCB,
	},
] as const satisfies readonly WeekIntro[]

export function weekIntroFor(theme: Theme): WeekIntro | undefined {
	return WEEK_INTROS.find(w => w.theme === theme)
}

/** Whether step two should show the primer rather than the examples. */
export function isBeginner(experience: HardwareExperience | null): boolean {
	return (
		experience === HardwareExperience.FIRST_TIME || experience === HardwareExperience.A_LITTLE || experience === null
	)
}
