import { PhaseStatus, Theme } from "@/lib/enums"

/**
 * Funding tiers.
 *
 * A tier is assigned per themed project when its DESIGN phase is approved. The tier's dollars are parts money, so the decision has to land before the build starts, not after it.
 *
 * A tier decides ONE thing: how many of a design week's hours are spoken for by the project itself. Those `fundingHours` earn dollars, not coins – they are what the grant buys. Every hour above them is banked or spent.
 *
 * It decides nothing about the machine at the end of the season. That is paid for out of banked coins at the same rate on every tier, and how many hours a week must bank is a property of the printer someone is saving for, not of the tier they are working at – see ./printers.ts. Tier 1 and Tier 3 both reach a Bambu P1S; Tier 3 simply has more funded hours sitting underneath the same banking.
 *
 * This is why there is no `bankHours` here any more. It used to be a tier property (2/5/10), which quietly made the expensive machines unreachable from Tier 1 and the cheap ones over-funded from Tier 3.
 */
export interface Tier {
	readonly blurb: string
	readonly detail: string
	/** The time a tier's build takes, as onboarding shows it beside the grant. */
	readonly estimate: string
	/** Hours the grant covers. These buy parts, not coins. */
	readonly fundingHours: number
	/** Grant paid through the YSWS pipeline, in whole USD. */
	readonly grantUsd: number
	readonly id: 1 | 2 | 3
	readonly name: string
	/**
	 * Real projects built at this tier, shown when choosing one. Keyed by theme, because a tier is shared by every week but what fits in it is not.
	 */
	readonly showcase: Partial<Record<Theme, readonly TierShowcaseProject[]>>
}

export interface TierShowcaseProject {
	/** The project's repo. */
	readonly href: string
	/** A picture of the finished board. Remote hosts must be in next.config's remotePatterns. */
	readonly image: string
	readonly title: string
}

// Numbers are the program designer's, and match the tier cards in the platform comp. Changing them is this file and nothing else – every review freezes the numbers it actually used onto SubmissionReview, so editing these does not rewrite anyone's history.
export const TIERS = [
	{
		blurb: "A focused build you can finish over a couple of weekends.",
		detail:
			"The right pick if this is your first board, model or circuit. Parts are cheap, the scope is one evening of soldering, and nothing here needs a tool you do not already have.",
		estimate: "~10-15h",
		fundingHours: 6,
		grantUsd: 30,
		id: 1,
		name: "Tier 1",
		showcase: {
			[Theme.PCB]: [
				{
					href: "https://github.com/Carabouille/Cara-s-Macropad",
					image: "https://cdn.hackclub.com/01a0ee6c-124f-77a8-91db-d07f984a9063/image.png",
					title: "Really polished macropad or basic keyboard!",
				},
				{
					href: "https://github.com/hekinav/helsinki-live-train-map",
					image: "https://cdn.hackclub.com/01a0ee6c-c350-7b98-9412-6f69f7a70c7c/image.png",
					title: "A PCB tool to help you or someone else!",
				},
				{
					href: "https://github.com/penguinissus/calcifer-devboard",
					image: "https://cdn.hackclub.com/01a0ee6f-5c3b-75f8-a4a6-c5454d830469/image.png",
					title: "A super basic devboard!",
				},
			],
		},
	},
	{
		blurb: "A multi-part build with real integration work.",
		detail:
			"For a project with a real enclosure, a handful of ICs, or a part you have to wait on. Most people land here by week three.",
		estimate: "~16-23h",
		fundingHours: 13,
		grantUsd: 65,
		id: 2,
		name: "Tier 2",
		showcase: {
			[Theme.PCB]: [
				{
					href: "https://github.com/noxaevi/macroboard",
					image: "https://cdn.hackclub.com/01a0ee73-aedd-7928-9ac1-82e187ac440f/image.png",
					title: "A really polished keyboard!",
				},
				{
					href: "https://github.com/codinga593/IRIS",
					image: "https://cdn.hackclub.com/01a0ee75-4bf4-743b-b6e1-32295e5d501a/flightcontroller.png",
					title: "A flight controller board!",
				},
			],
		},
	},
	{
		blurb: "An ambitious build with novel engineering.",
		detail:
			"Four-layer boards, motorised anything, or a build that needs two revisions to work. Pick this only if you have shipped something before.",
		estimate: "~24h+",
		fundingHours: 20,
		grantUsd: 100,
		id: 3,
		name: "Tier 3",
		showcase: {
			[Theme.PCB]: [
				{
					href: "https://github.com/cheyao/icepi-zero",
					image: "https://cdn.hackclub.com/01a0ee76-053f-7f0a-af3a-bce42977fede/icepi.png",
					title: "An FPGA devboard!",
				},
			],
		},
	},
] as const satisfies readonly Tier[]

export type TierId = (typeof TIERS)[number]["id"]

export const TIER_IDS: readonly TierId[] = TIERS.map(t => t.id)

/** The tier everyone starts on, and the floor the week's ask is measured from. */
export const [ENTRY_TIER] = TIERS

export function getTier(id: number): Tier | undefined {
	return TIERS.find(t => t.id === id)
}

export function getTierOrThrow(id: number): Tier {
	const tier = getTier(id)
	if (!tier) throw new Error(`Unknown tier: ${id}`)
	return tier
}

export function isTierId(id: unknown): id is TierId {
	return typeof id === "number" && TIER_IDS.some(tier => tier === id)
}

/**
 * The highest tier whose funded block the given hours cover.
 *
 * A tier's grant buys its funded block of hours, so hours below a tier's floor cannot pay that tier's grant. The submit gate refuses a hand-in below the floor (lib/submissions), so this only bites when a decision approves less time than was logged: the tier then steps down to the one the approved hours earned, rather than the grant staying at a level the hours do not cover. Null when even Tier 1 is out of reach, which is a design with no parts grant.
 */
export function tierForHours(hours: number): Tier | null {
	const affordable = TIERS.filter(t => hours >= t.fundingHours)
	return affordable.at(-1) ?? null
}

/**
 * The tier a project is priced and gated against, out of the two columns that can carry one.
 *
 * `tier` is the reviewer's decision at design approval, and is written only there. `requestedTier` is the maker's ask until then, and the API refuses to write anything else. So the decision leads once the design is approved and the ask leads before it.
 *
 * Reading `tier` first on an unapproved project lets anything that wrote it early shadow the ask. The Stasis import did exactly that: it copied the old platform's tier onto every row it moved, approved or not, so an imported draft sits at Tier 1 with a Tier 2 request on top – and every gate, price and grant read the Tier 1 it never asked for, refusing a cart Tier 2 covers and naming Tier 1's grant while the maker's project says Tier 2.
 */
export function projectTierId(project: {
	designStatus: PhaseStatus
	requestedTier: number | null
	tier: number | null
}): TierId {
	// The first column in precedence order that actually holds a tier. A null, or a number no tier has, falls through to the next rather than to Tier 1 by itself.
	const order =
		project.designStatus === PhaseStatus.approved
			? [project.tier, project.requestedTier]
			: [project.requestedTier, project.tier]
	return order.find(isTierId) ?? ENTRY_TIER.id
}
