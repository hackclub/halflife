import { Phase, Theme } from "@/app/generated/prisma/enums"

/**
 * Every tunable program number lives in this file and ./tiers.ts. If you are about to hardcode a threshold anywhere else, put it here instead.
 */

/** Shown wherever the currency is named. One line to rename it everywhere. */
export const CREDIT_NAME_PLURAL = "coins"

/**
 * One coin is one dollar, and an hour of work is worth five of them.
 *
 * This single rate drives the whole economy: design hours beyond the tier's funding hours, and every build hour. It is the budget sheet's $5, and every printer price in ./printers.ts is paced against it, so changing it moves every machine in the catalogue out of reach at once.
 */
export const COINS_PER_HOUR = 5

/**
 * Ceiling on SPENDABLE coins minted per phase. `approvedHours` can come from a reviewer typing into a box, and a fat-fingered 1000 should not mint five thousand coins. Applied per phase, so one project's design and build together can mint up to twice this; the banked half needs no cap: it is bounded by the goal's weekly banking rate by construction.
 */
export const MAX_COINS_PER_PROJECT = 250

/**
 * The most hours one phase may be approved for.
 *
 * An hour count can come from a person typing into a box or from a machine posting a number, and either can be wrong by three orders of magnitude. A figure that can be typed must not be able to mint an absurd amount of money, so the bound lives here rather than in each place that reads hours: the console's override, the per-entry hours decisions and the machine path all answer to this one number.
 *
 * A week of full-time hours is the ceiling. Nothing in the programme legitimately approves more than that for one phase, and the console path has always refused to.
 */
export const MAX_APPROVED_HOURS = 168

/** Flat award for shipping a theme (design and build both approved). */
export const THEME_COMPLETION_BONUS = 25

/**
 * A build week is the same five hours for everyone, split into two sittings.
 *
 * None of it is funded – the parts were bought with the design week's grant – so every one of these hours banks. This is the `5 hours * 5 build weeks * $5` term the budget sheet subtracts from a machine's price before it works out what the design weeks have to carry, which is why it lives here rather than in the curriculum: the printer catalogue depends on it.
 */
export const BUILD_BLOCKS = [2, 3] as const
export const BUILD_HOURS: number = BUILD_BLOCKS.reduce((n, h) => n + h, 0)

export const THEMES_REQUIRED_FOR_PRINTER = 5

/** Fallbacks used only when seeding a fresh ProgramSettings row. */
export const DEFAULT_EVENT_START_DATE = process.env.PROGRAM_START_DATE ?? "2026-10-05"
export const DEFAULT_PROGRAM_TIMEZONE = process.env.PROGRAM_TIMEZONE ?? "America/New_York"

export const TOTAL_WEEKS = 10
export const DESIGN_WEEKS = 5

/**
 * The trail's first node, the setup questionnaire. The server marks it done from onboardingCompletedAt and the client marks it done the moment setup is finished; both have to name the same node.
 */
export const ONBOARDING_CHECKPOINT_ID = "w1-onboard"

/**
 * How much a project has to say about itself before a week can be handed in.
 *
 * A name and one line is not enough for a reviewer to judge what they are looking at, so the submit gate asks for a real description. It is enforced at submit rather than while the project is still being written, so a half-formed idea can be saved and come back to.
 */
export const MIN_PROJECT_DESCRIPTION_CHARS = 100

/**
 * Streaks.
 *
 * A day counts when the participant logs a work session with that day as its `effectiveDate` in the program timezone – the same stamp the journal already writes, so the streak is derived from work rather than from logging in.
 *
 * `STREAK_GRACE_DAYS = 1` means one missed day does not reset you: the streak breaks on the second. Hardware work is not a daily-habit app, and a rule that punishes a day at a robotics competition would mostly teach people to file a fake session.
 */
export const STREAK_GRACE_DAYS = 1

export interface ThemeDef {
	readonly blurb: string
	/** Program week its build phase is scheduled for. */
	readonly buildWeek: number
	/** Program week this theme's design phase is scheduled for. */
	readonly designWeek: number
	readonly id: Theme
	readonly label: string
	readonly slug: string
}

// designWeek/buildWeek are written out rather than derived from array index. `index + 1` / `index + 6` is exactly the implicit coupling that breaks the day someone inserts a pilot week zero.
export const THEMES = [
	{
		blurb: "Design a printed circuit board, then have it fabbed and assemble it.",
		buildWeek: 6,
		designWeek: 1,
		id: Theme.PCB,
		label: "PCBs",
		slug: "pcb",
	},
	{
		blurb: "Model something in CAD, then print or machine it.",
		buildWeek: 7,
		designWeek: 2,
		id: Theme.CAD,
		label: "CAD",
		slug: "cad",
	},
	{
		blurb: "Design a sound-making circuit, then build and play it.",
		buildWeek: 8,
		designWeek: 3,
		id: Theme.SYNTH,
		label: "Music",
		slug: "synth",
	},
	{
		blurb: "Design something that drives a display, then wire it up.",
		buildWeek: 9,
		designWeek: 4,
		id: Theme.DISPLAYS,
		label: "Displays",
		slug: "displays",
	},
	{
		blurb: "Design a computer from discrete logic, then breadboard it.",
		buildWeek: 10,
		designWeek: 5,
		id: Theme.BREADBOARD_COMPUTER,
		label: "Breadboard Computer",
		slug: "breadboard",
	},
] as const satisfies readonly ThemeDef[]

export type ThemeSlug = (typeof THEMES)[number]["slug"]

/**
 * The pre-season track warm-up projects are filed on.
 *
 * Deliberately not in `THEMES`: `THEMES` is the ten-week season, and a sixth entry there would invent an eleventh week, count toward printer qualification, and collide with a season slot when a project's week is derived from its index. Iteration over the season reads `THEMES`; anything that only needs a theme's label or slug asks `getThemeDef`, which knows this one too. Its weeks are 0 because it is not scheduled at all.
 */
export const WARMUP_THEME: ThemeDef = {
	blurb: "A project submitted during the pre-season warm-up weeks.",
	buildWeek: 0,
	designWeek: 0,
	id: Theme.WARMUP,
	label: "Warm Up",
	slug: "warmup",
}

/**
 * The `weekId` the store gives a warm-up project.
 *
 * Warm-up projects have no scheduled week, but a client `Project` carries one (it addresses the project detail route and picks the card's scene), so they borrow week 0 – a value no curriculum week can take.
 */
export const WARMUP_WEEK_ID = 0

/**
 * How many warm-up projects one maker may have.
 *
 * This caps the grant budget, not the ideas. Warm-up rows are deliberately exempt from the one-per-theme index so a maker can try more than one thing, and none of them takes a season slot – but a warm-up handed in as a design is approved like any other and carries a real parts grant at the tier's amount, so an uncapped number of them is an uncapped number of grants.
 *
 * Three is generous enough for a maker to try a few ideas before week one opens, and it bounds the pre-season parts money at three grants per maker. It leaves the season's own five themes exactly as they were: the cap is on the warm-up rows only.
 */
export const MAX_WARMUP_PROJECTS = 3

export function getThemeDef(theme: Theme): ThemeDef {
	const def = theme === Theme.WARMUP ? WARMUP_THEME : THEMES.find(t => t.id === theme)
	if (!def) throw new Error(`Unknown theme: ${theme}`)
	return def
}

/**
 * What to call a project in front of somebody else.
 *
 * A maker may leave the title blank, and a blank title is not a name – so every notice, dispute thread and review queue row falls back to the week's own label. It was written out four times, and the copy in `airtable/sync` is the dangerous kind: a fallback that differs by one word reads as a different project rather than as a bug.
 */
export function projectDisplayTitle(project: { title: string; theme: Theme }): string {
	return project.title.trim() || getThemeDef(project.theme).label
}

/** The theme and phase a given program week is scheduled for. */
export function scheduleForWeek(week: number): { theme: ThemeDef; phase: Phase } | null {
	const design = THEMES.find(t => t.designWeek === week)
	if (design) return { phase: Phase.DESIGN, theme: design }
	const build = THEMES.find(t => t.buildWeek === week)
	if (build) return { phase: Phase.BUILD, theme: build }
	return null
}

export function scheduledWeekFor(theme: Theme, phase: Phase): number {
	const def = getThemeDef(theme)
	return phase === Phase.DESIGN ? def.designWeek : def.buildWeek
}
