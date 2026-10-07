import { Theme } from "@/app/generated/prisma/enums"

/**
 * Funding tiers.
 *
 * A tier is assigned per themed project when its DESIGN phase is approved. The tier's dollars are parts money, so the decision has to land before the build starts, not after it.
 *
 * A tier decides ONE thing: how many of a design week's hours are spoken for by the project itself. Those `fundingHours` earn dollars, not coins – they are what the grant buys. Every hour above them is banked or spent.
 *
 * It decides nothing about the machine at the end of the season. That is paid
 * for out of banked coins at the same rate on every tier, and how many hours a
 * week must bank is a property of the printer someone is saving for, not of the tier they are working at – see ./printers.ts. Tier 1 and Tier 3 both reach a Bambu P1S; Tier 3 simply has more funded hours sitting underneath the same banking.
 *
 * This is why there is no `bankHours` here any more. It used to be a tier property (2/5/10), which quietly made the expensive machines unreachable from Tier 1 and the cheap ones over-funded from Tier 3.
 */
export interface Tier {
	readonly id: 1 | 2 | 3
	readonly name: string
	/** Grant paid through the YSWS pipeline, in whole USD. */
	readonly grantUsd: number
	/** Hours the grant covers. These buy parts, not coins. */
	readonly fundingHours: number
	readonly blurb: string
	readonly detail: string
	readonly examples: readonly string[]
	/** The time a tier's build takes, as onboarding shows it beside the grant. */
	readonly estimate: string
	/**
	 * Real projects built at this tier, shown when choosing one. Keyed by theme, because a tier is shared by every week but what fits in it is not.
	 */
	readonly showcase: Partial<Record<Theme, readonly TierShowcaseProject[]>>
}

export interface TierShowcaseProject {
	readonly title: string
	/** A picture of the finished board. Remote hosts must be in next.config's remotePatterns. */
	readonly image: string
	/** The project's repo. */
	readonly href: string
}

// Numbers are the program designer's, and match the tier cards in the platform comp. Changing them is this file and nothing else – every review freezes the numbers it actually used onto SubmissionReview, so editing these does not rewrite anyone's history.
export const TIERS = [
	{
		id: 1,
		name: "Tier 1",
		grantUsd: 30,
		estimate: "~10-15h",
		showcase: {
			[Theme.PCB]: [
				{
					title: "Really polished macropad or basic keyboard!",
					image: "https://cdn.hackclub.com/01a0ee6c-124f-77a8-91db-d07f984a9063/image.png",
					href: "https://github.com/Carabouille/Cara-s-Macropad",
				},
				{
					title: "A PCB tool to help you or someone else!",
					image: "https://cdn.hackclub.com/01a0ee6c-c350-7b98-9412-6f69f7a70c7c/image.png",
					href: "https://github.com/hekinav/helsinki-live-train-map",
				},
				{
					title: "A super basic devboard!",
					image: "https://cdn.hackclub.com/01a0ee6f-5c3b-75f8-a4a6-c5454d830469/image.png",
					href: "https://github.com/penguinissus/calcifer-devboard",
				},
			],
		},
		fundingHours: 6,
		blurb: "A focused build you can finish over a couple of weekends.",
		detail:
			"The right pick if this is your first board, model or circuit. Parts are cheap, the scope is one evening of soldering, and nothing here needs a tool you do not already have.",
		examples: ["Simple 2-layer breakout board", "Single-part printed enclosure"],
	},
	{
		id: 2,
		name: "Tier 2",
		grantUsd: 65,
		estimate: "~16-23h",
		showcase: {
			[Theme.PCB]: [
				{
					title: "A really polished keyboard!",
					image: "https://cdn.hackclub.com/01a0ee73-aedd-7928-9ac1-82e187ac440f/image.png",
					href: "https://github.com/noxaevi/macroboard",
				},
				{
					title: "A flight controller board!",
					image: "https://cdn.hackclub.com/01a0ee75-4bf4-743b-b6e1-32295e5d501a/flightcontroller.png",
					href: "https://github.com/codinga593/IRIS",
				},
			],
		},
		fundingHours: 13,
		blurb: "A multi-part build with real integration work.",
		detail:
			"For a project with a real enclosure, a handful of ICs, or a part you have to wait on. Most people land here by week three.",
		examples: ["4-layer board with an MCU", "Multi-part mechanism"],
	},
	{
		id: 3,
		name: "Tier 3",
		grantUsd: 100,
		estimate: "~24h+",
		showcase: {
			[Theme.PCB]: [
				{
					title: "An FPGA devboard!",
					image: "https://cdn.hackclub.com/01a0ee76-053f-7f0a-af3a-bce42977fede/icepi.png",
					href: "https://github.com/cheyao/icepi-zero",
				},
			],
		},
		fundingHours: 20,
		blurb: "An ambitious build with novel engineering.",
		detail:
			"Four-layer boards, motorised anything, or a build that needs two revisions to work. Pick this only if you have shipped something before.",
		examples: ["Polyphonic instrument voice card", "Full breadboard CPU"],
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
 * Compares against `fundingHours`: someone who worked 14 hours has cleared Tier 2's funded block even though they are short of what a full Tier 2 week asks, and the reviewer wants Tier 2 offered so they can see that.
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
