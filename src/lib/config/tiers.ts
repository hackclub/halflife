/**
 * Funding tiers.
 *
 * A tier is assigned per themed project when its DESIGN phase is approved. The
 * tier's dollars are parts money, so the decision has to land before the build
 * starts, not after it.
 *
 * A tier decides ONE thing: how many of a design week's hours are spoken for by
 * the project itself. Those `fundingHours` earn dollars, not coins — they are
 * what the grant buys. Every hour above them is banked or spent.
 *
 * It decides nothing about the machine at the end of the season. That is paid
 * for out of banked coins at the same rate on every tier, and how many hours a
 * week must bank is a property of the printer someone is saving for, not of the
 * tier they are working at — see ./printers.ts. Tier 1 and Tier 3 both reach a
 * Bambu P1S; Tier 3 simply has more funded hours sitting underneath the same
 * banking.
 *
 * This is why there is no `bankHours` here any more. It used to be a tier
 * property (2/5/10), which quietly made the expensive machines unreachable from
 * Tier 1 and the cheap ones over-funded from Tier 3.
 */
export interface Tier {
  readonly id: 1 | 2 | 3
  readonly name: string
  /** Grant paid through the YSWS pipeline, in whole USD. */
  readonly grantUsd: number
  /** Hours the grant covers. These buy parts, not coins. */
  readonly fundingHours: number
  /** How the week's ask is phrased to the participant. */
  readonly hours: string
  /** How banking is phrased to the participant. */
  readonly toBank: string
  readonly blurb: string
  readonly detail: string
  readonly examples: readonly string[]
}

// Numbers are the program designer's, and match the tier cards in the platform
// comp. Changing them is this file and nothing else — every review freezes the
// numbers it actually used onto SubmissionReview, so editing these does not
// rewrite anyone's history.
export const TIERS = [
  {
    id: 1,
    name: "Tier 1",
    grantUsd: 30,
    fundingHours: 6,
    hours: "6–8 hours of work",
    toBank: "6 hours fund the project, the rest banks at 5 coins an hour",
    blurb: "A focused build you can finish over a couple of weekends.",
    detail:
      "The right pick if this is your first board, model or circuit. Parts are cheap, the scope is one evening of soldering, and nothing here needs a tool you do not already have.",
    examples: ["Simple 2-layer breakout board", "Single-part printed enclosure"],
  },
  {
    id: 2,
    name: "Tier 2",
    grantUsd: 65,
    fundingHours: 13,
    hours: "13–15 hours of work",
    toBank: "13 hours fund the project, the rest banks at 5 coins an hour",
    blurb: "A multi-part build with real integration work.",
    detail:
      "For a project with a real enclosure, a handful of ICs, or a part you have to wait on. Most people land here by week three.",
    examples: ["4-layer board with an MCU", "Multi-part mechanism"],
  },
  {
    id: 3,
    name: "Tier 3",
    grantUsd: 100,
    fundingHours: 24,
    hours: "24+ hours of work",
    toBank: "24 hours fund the project, the rest banks at 5 coins an hour",
    blurb: "An ambitious build with novel engineering.",
    detail:
      "Four-layer boards, motorised anything, or a build that needs two revisions to work. Pick this only if you have shipped something before.",
    examples: ["Polyphonic synth voice card", "Full breadboard CPU"],
  },
] as const satisfies readonly Tier[]

export type TierId = (typeof TIERS)[number]["id"]

export const TIER_IDS: readonly TierId[] = TIERS.map((t) => t.id)

/** The tier everyone starts on, and the floor the week's ask is measured from. */
export const ENTRY_TIER = TIERS[0]

export function getTier(id: number): Tier | undefined {
  return TIERS.find((t) => t.id === id)
}

export function getTierOrThrow(id: number): Tier {
  const tier = getTier(id)
  if (!tier) throw new Error(`Unknown tier: ${id}`)
  return tier
}

export function isTierId(id: unknown): id is TierId {
  return typeof id === "number" && TIER_IDS.includes(id as TierId)
}

/**
 * The tier an hour count falls into, for suggesting a default to a reviewer.
 *
 * Compares against `fundingHours`: someone who worked 14 hours has cleared
 * Tier 2's funded block even though they are short of what a full Tier 2 week
 * asks, and the reviewer wants Tier 2 offered so they can see that.
 */
export function suggestTierForHours(hours: number): TierId {
  let suggested: TierId = ENTRY_TIER.id
  for (const tier of TIERS) {
    if (hours >= tier.fundingHours) suggested = tier.id
  }
  return suggested
}

/** Airtable's `Complexity Tier` single-select label. */
export function tierAirtableLabel(id: number): string {
  const tier = getTier(id)
  return tier ? `Complexity ${tier.name}` : ""
}
