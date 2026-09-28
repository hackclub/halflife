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

export type OnboardingStepId = "experience" | "week" | "project" | "idea" | "tier" | "tracking"

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
  { id: "week", number: 2, heading: "Each week will have a theme, this week it's...", skippable: false },
  { id: "project", number: 3, heading: "Make your first project!", skippable: false },
  { id: "idea", number: 4, heading: "Stuck? Pick one of the following:", skippable: true },
  { id: "tier", number: 5, heading: "Choose a Tier", skippable: false },
  { id: "tracking", number: 6, heading: "Time Tracking", skippable: true },
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
 * A suggestion in the UI and nothing more — the participant can pick any tier,
 * and the reviewer decides the real one at design approval. Someone who has
 * never touched hardware being shown Tier 3 first is the thing this avoids.
 */
export function suggestedTierFor(experience: HardwareExperience | null): TierId {
  switch (experience) {
    case HardwareExperience.ITS_LIFE:
      return 3
    case HardwareExperience.A_GOOD_AMOUNT:
      return 2
    case HardwareExperience.FIRST_TIME:
    case HardwareExperience.A_LITTLE:
    default:
      return 1
  }
}

export const EXPERIENCE_OPTIONS = [
  {
    value: HardwareExperience.FIRST_TIME,
    label: "This is my first time!",
    hint: "Never touched a soldering iron. Perfect.",
  },
  {
    value: HardwareExperience.A_LITTLE,
    label: "just a little...",
    hint: "A kit or two, maybe an Arduino blink.",
  },
  {
    value: HardwareExperience.A_GOOD_AMOUNT,
    label: "Yeah, i've built a good amount",
    hint: "You have shipped a project that works.",
  },
  {
    value: HardwareExperience.ITS_LIFE,
    label: "hardware... is life...",
    hint: "You own more multimeters than mugs.",
  },
] as const

/**
 * Starter projects, offered when someone has no idea of their own.
 *
 * Taking one locks the tier request to 1, so these have to be genuinely Tier 1
 * in scope — roughly six to eight hours. Only the PCB set is reachable from
 * the first checkpoint; the others exist because the design note says every
 * later design week repeats "project creation/tier selection".
 */
export interface StarterProject {
  readonly id: string
  readonly theme: Theme
  readonly title: string
  readonly description: string
}

export const STARTER_PROJECTS = [
  {
    id: "pcb-blinky-badge",
    theme: Theme.PCB,
    title: "A blinky conference badge",
    description:
      "A two-layer board with a coin cell, a microcontroller and a handful of LEDs, shaped however you like. The smallest board that still counts: schematic, layout, order, solder.",
  },
  {
    id: "pcb-usb-macropad",
    theme: Theme.PCB,
    title: "A four-key macropad",
    description:
      "Four mechanical switches, a USB-C connector and a microcontroller that speaks HID. Pick a layout you will actually use — it ends the week as something on your desk.",
  },
  {
    id: "pcb-sensor-breakout",
    theme: Theme.PCB,
    title: "A sensor breakout board",
    description:
      "Pick a sensor you want to use in a later build and give it a breakout: regulator, decoupling, a header, and a footprint you have checked against the datasheet.",
  },
] as const satisfies readonly StarterProject[]

export function starterProjectsFor(theme: Theme): readonly StarterProject[] {
  return STARTER_PROJECTS.filter((p) => p.theme === theme)
}

export function getStarterProject(id: string): StarterProject | undefined {
  return STARTER_PROJECTS.find((p) => p.id === id)
}

/** The tier a starter project is scoped to. Not configurable — see above. */
export const STARTER_PROJECT_TIER: TierId = 1

/**
 * Step two's copy: "Each week will have a theme, this week it's..."
 *
 * The comp branches this on the answer to question one — "If beginner:
 * information about PCBs, else: example projects" — so both halves are here
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
    kicker: "Printed Circuit Board Week:",
    headline: "DESIGN YOUR PCB",
    primer:
      "A printed circuit board is a sheet of fibreglass with copper traces etched into it, so components solder straight onto the board instead of being wired by hand. This week you make one end to end: a schematic that says what connects to what, a layout that says where everything physically sits, and a parts cart to order from. At the end of the week you send it off, and a fab house posts you the real thing.",
    examples: [
      "A board that replaces a breadboard project you have already built",
      "A shield or hat for a dev board you own",
      "Something with a connector you have never routed before",
    ],
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
