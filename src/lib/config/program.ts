import { Theme, Phase } from "@/app/generated/prisma/enums"

/**
 * Every tunable program number lives in this file and ./tiers.ts. If you are
 * about to hardcode a threshold anywhere else, put it here instead.
 */

/** Shown wherever the currency is named. One line to rename it everywhere. */
export const CREDIT_NAME_PLURAL = "coins"
export const CREDIT_NAME_SINGULAR = "coin"

/**
 * One coin is one dollar, and an hour of work is worth five of them.
 *
 * This single rate drives the whole economy: design hours beyond the tier's
 * funding hours, and every build hour. It is the budget sheet's $5, and every
 * printer price in ./printers.ts is paced against it, so changing it moves
 * every machine in the catalogue out of reach at once.
 */
export const COINS_PER_HOUR = 5

/**
 * Ceiling on SPENDABLE coins minted from one project's hours. `approvedHours`
 * can come from a reviewer typing into a box, and a fat-fingered 1000 should
 * not mint five thousand coins. The banked half needs no cap: it is bounded by
 * the goal's weekly banking rate by construction.
 */
export const MAX_COINS_PER_PROJECT = 250

/** Flat award for shipping a theme (design and build both approved). */
export const THEME_COMPLETION_BONUS = 25

/**
 * A build week is the same five hours for everyone, split into two sittings.
 *
 * None of it is funded — the parts were bought with the design week's grant —
 * so every one of these hours banks. This is the `5 hours * 5 build weeks * $5`
 * term the budget sheet subtracts from a machine's price before it works out
 * what the design weeks have to carry, which is why it lives here rather than
 * in the curriculum: the printer catalogue depends on it.
 */
export const BUILD_BLOCKS = [2, 3] as const
export const BUILD_HOURS: number = BUILD_BLOCKS.reduce((n, h) => n + h, 0)

export const THEMES_REQUIRED_FOR_PRINTER = 5

/** Fallbacks used only when seeding a fresh ProgramSettings row. */
export const DEFAULT_EVENT_START_DATE = process.env.PROGRAM_START_DATE ?? "2026-09-07"
export const DEFAULT_PROGRAM_TIMEZONE = process.env.PROGRAM_TIMEZONE ?? "America/New_York"

export const TOTAL_WEEKS = 10
export const DESIGN_WEEKS = 5

/**
 * The trail's first node, the setup questionnaire. The server marks it done
 * from onboardingCompletedAt and the client marks it done the moment setup is
 * finished; both have to name the same node.
 */
export const ONBOARDING_CHECKPOINT_ID = "w1-onboard"

/**
 * Streaks.
 *
 * A day counts when the participant logs a work session with that day as its
 * `effectiveDate` in the program timezone — the same stamp the journal already
 * writes, so the streak is derived from work rather than from logging in.
 *
 * `STREAK_GRACE_DAYS = 1` means one missed day does not reset you: the streak
 * breaks on the second. Hardware work is not a daily-habit app, and a rule
 * that punishes a day at a robotics competition would mostly teach people to
 * file a fake session.
 */
export const STREAK_GRACE_DAYS = 1

export interface ThemeDef {
  readonly id: Theme
  readonly slug: string
  readonly label: string
  readonly blurb: string
  /** Program week this theme's design phase is scheduled for. */
  readonly designWeek: number
  /** Program week its build phase is scheduled for. */
  readonly buildWeek: number
}

// designWeek/buildWeek are written out rather than derived from array index.
// `index + 1` / `index + 6` is exactly the implicit coupling that breaks the
// day someone inserts a pilot week zero.
export const THEMES = [
  {
    id: Theme.PCB,
    slug: "pcb",
    label: "PCBs",
    blurb: "Design a printed circuit board, then have it fabbed and assemble it.",
    designWeek: 1,
    buildWeek: 6,
  },
  {
    id: Theme.CAD,
    slug: "cad",
    label: "CAD",
    blurb: "Model something in CAD, then print or machine it.",
    designWeek: 2,
    buildWeek: 7,
  },
  {
    id: Theme.SYNTH,
    slug: "synth",
    label: "Synth",
    blurb: "Design a sound-making circuit, then build and play it.",
    designWeek: 3,
    buildWeek: 8,
  },
  {
    id: Theme.DISPLAYS,
    slug: "displays",
    label: "Displays",
    blurb: "Design something that drives a display, then wire it up.",
    designWeek: 4,
    buildWeek: 9,
  },
  {
    id: Theme.BREADBOARD_COMPUTER,
    slug: "breadboard",
    label: "Breadboard Computer",
    blurb: "Design a computer from discrete logic, then breadboard it.",
    designWeek: 5,
    buildWeek: 10,
  },
] as const satisfies readonly ThemeDef[]

export type ThemeSlug = (typeof THEMES)[number]["slug"]

export function getThemeDef(theme: Theme): ThemeDef {
  const def = THEMES.find((t) => t.id === theme)
  if (!def) throw new Error(`Unknown theme: ${theme}`)
  return def
}

export function themeDefBySlug(slug: string): ThemeDef | undefined {
  return THEMES.find((t) => t.slug === slug)
}

/** The theme and phase a given program week is scheduled for. */
export function scheduleForWeek(week: number): { theme: ThemeDef; phase: Phase } | null {
  const design = THEMES.find((t) => t.designWeek === week)
  if (design) return { theme: design, phase: Phase.DESIGN }
  const build = THEMES.find((t) => t.buildWeek === week)
  if (build) return { theme: build, phase: Phase.BUILD }
  return null
}

export function scheduledWeekFor(theme: Theme, phase: Phase): number {
  const def = getThemeDef(theme)
  return phase === Phase.DESIGN ? def.designWeek : def.buildWeek
}
