/**
 * The grand-prize catalogue – the thing every earned coin is paced against.
 *
 * Numbers come straight from the budget sheet (Half life budget – Printers), and nothing here is invented on top of them. One coin is one dollar, so a machine costs its shop price. Pace hours a week are the sheet's column 4:
 *
 *   pace = (shopPrice - 5 hours * 5 build weeks * $5) / 5 design weeks / $5
 *
 * Read the shape of that formula, because every projection below depends on it: the season is ten weeks, and the two halves earn differently. The five build weeks are the same five hours for everyone and none of them is funded, so they hand every maker the same flat BUILD_WEEK_COINS whatever machine they picked. Only the remainder is paced against the design weeks, and there are five of those. A projection that charges the whole price to the design rate asks for weeks the season does not have.
 *
 * Those pace hours are the same whatever tier you are on – the tier decides how many funded hours sit underneath them, not how much you earn. They are guidance only: every coin is spendable, and no pot is locked.
 */
import { BUILD_HOURS, COINS_PER_HOUR, DESIGN_WEEKS, TOTAL_WEEKS } from "./program"
import { ENTRY_TIER } from "./tiers"

export type PrinterKind = "bedslinger" | "corexy" | "resin" | "cnc"

export interface PrinterGoal {
	/** How the maker describes it on the product page `link` points at. */
	blurb: string
	/** What it costs in the shop. One coin is one dollar. */
	coins: number
	/**
	 * Coins a design week earns at that pace – pace hours at $5 each. A build week does not use this; it earns BUILD_WEEK_COINS / BUILD_WEEKS flat.
	 */
	coinsPerWeek: number
	/** Hours a design week asks on tier 1 to land this by the end of the season. */
	hoursPerWeek: number
	id: string
	kind: PrinterKind
	link: string
	name: string
	/** Short flag for anything that is not a plain FDM printer. */
	note?: string
	/** Of those hours, the ones past the parts funding – the weekly earn pace. */
	paceHours: number
	/** Sticker price, before anyone ships anything. */
	price: number
	/** What it actually costs us – shipping and tax included. */
	shopPrice: number
}

/**
 * Nobody is asked for less than ten hours a week on tier 1. The cheapest machine works out at exactly ten on the budget sheet, so the floor holds it at that; every other goal already clears it on its own.
 */
export const TIER1_MIN_HOURS = 10

/** The sheet as typed, minus the one column that is derived from another. */
type SheetRow = Omit<PrinterGoal, "coinsPerWeek">

const SHEET: SheetRow[] = [
	{
		blurb: "Perfect for beginners: easy, reliable, and ready for every project.",
		coins: 219,
		hoursPerWeek: 10,
		id: "ender-3-v3-se",
		kind: "bedslinger",
		link: "https://store.creality.com/products/ender-3-v3-se-3d-printer",
		name: "Ender 3 V3 SE",
		paceHours: 4,
		price: 199,
		shopPrice: 218.9,
	},
	{
		blurb: "Ultimate performance in a compact build volume, with features once found only in high-end models.",
		coins: 241,
		hoursPerWeek: 10.64,
		id: "bambu-a1-mini",
		kind: "bedslinger",
		link: "https://us.store.bambulab.com/products/a1-mini",
		name: "Bambu A1 Mini",
		paceHours: 4.64,
		price: 219,
		shopPrice: 240.9,
	},
	{
		blurb: "The best resin 3D printer for budget-savvy beginners, with smart self-check and auto-leveling.",
		coins: 248,
		hoursPerWeek: 10.9,
		id: "elegoo-mars-4",
		kind: "resin",
		link: "https://us.elegoo.com/collections/lcd-printers/products/mars-5-4k-6-6inch-monochrome-lcd-resin-3d-printer",
		name: "ELEGOO Mars 5",
		note: "Resin",
		paceHours: 4.9,
		price: 225,
		shopPrice: 247.5,
	},
	{
		blurb: "Up to 500mm/s printing, 121-point auto bed leveling and a 300°C dual-gear direct extruder.",
		coins: 274,
		hoursPerWeek: 11.96,
		id: "elegoo-neptune-4",
		kind: "bedslinger",
		link: "https://us.elegoo.com/collections/fdm-printers/products/elegoo-neptune-4-fdm-3d-printer",
		name: "ELEGOO Neptune 4",
		paceHours: 5.96,
		price: 249,
		shopPrice: 273.9,
	},
	{
		blurb: "A 3-axis CNC router for engraving and milling soft metals, wood, plastic, acrylic, PVC and PCBs.",
		coins: 275,
		hoursPerWeek: 12,
		id: "monoprice-cnc",
		kind: "cnc",
		link: "https://www.monoprice.com/product?p_id=44220",
		name: "Monoprice CNC Router",
		note: "CNC Router",
		paceHours: 6,
		price: 249.99,
		shopPrice: 274.99,
	},
	{
		blurb: "A high-speed CoreXY 3D printer with easy setup, smart auto-calibration and reliable precision.",
		coins: 329,
		hoursPerWeek: 14.16,
		id: "elegoo-centauri-2",
		kind: "corexy",
		link: "https://us.elegoo.com/collections/fdm-printers/products/centauri-2",
		name: "ELEGOO Centauri 2",
		paceHours: 8.16,
		price: 299,
		shopPrice: 328.9,
	},
	{
		blurb: "Fully automated, multi-color printing: a full-size bed-slinger with CoreXY speed.",
		coins: 329,
		hoursPerWeek: 14.16,
		id: "bambu-a1",
		kind: "bedslinger",
		link: "https://us.store.bambulab.com/products/a1",
		name: "Bambu A1",
		paceHours: 8.16,
		price: 299,
		shopPrice: 328.9,
	},
	{
		blurb: "A high-speed enclosed 3D printer with a CoreXY design and reliable performance right out of the box.",
		coins: 439,
		hoursPerWeek: 18.56,
		id: "bambu-p1s",
		kind: "corexy",
		link: "https://us.store.bambulab.com/products/p1s",
		name: "Bambu P1S",
		paceHours: 12.56,
		price: 399,
		shopPrice: 438.9,
	},
]

/**
 * The coins one paced hour is worth – the sheet's $5, at a coin to the dollar. Re-exported rather than restated so the catalogue and the ledger cannot disagree about what an hour is worth.
 */
export { COINS_PER_HOUR } from "./program"

/**
 * Where a printer is paid out as a grant instead of being shipped.
 *
 * Egypt is the one so far: a 3D printer is notoriously expensive to buy there and worse to send, so the award becomes a grant of the printer's value rather than a delivery. The grant may not stretch to the exact model we would have shipped, so the machine a maker ends up with can differ from the one on their goal.
 *
 * Keyed by the country name `countryOfTimezone` reports (see lib/regions), because an account's timezone is the only per-user geography with real coverage – it is what the admin overview's country breakdown reads too. Adding a country here is the whole change: the shop's notice follows from it.
 */
export const PRINTER_GRANT_COUNTRIES: readonly string[] = ["Egypt"]

/** Whether a printer reaches this country as a grant rather than a delivery. */
export function printerComesAsGrant(country: string): boolean {
	return PRINTER_GRANT_COUNTRIES.includes(country)
}

/**
 * What a maker in one of those countries reads in the shop.
 *
 * Answers all three things the notice has to: why (printers are expensive there), what changes (a grant, not a delivery), and the consequence they need to plan around (it may not buy the exact model).
 */
export const PRINTER_GRANT_NOTICE =
	"3D printers are notoriously expensive in Egypt, so if you earn one we'll give you its value as a grant instead of delivering it. The grant may not stretch to the exact printer we'd have shipped, so you may not be able to get that specific model for the money."

/** The season, counted off the program schedule rather than restated here. */
export { TOTAL_WEEKS as SEASON_WEEKS } from "./program"
export const BUILD_WEEKS = TOTAL_WEEKS - DESIGN_WEEKS
export { DESIGN_WEEKS } from "./program"

/**
 * What the build half earns for everyone, whichever machine is on the wall: BUILD_HOURS a week, none of it funded, at COINS_PER_HOUR. This is the `5 hours * 5 build weeks * $5` term the sheet subtracts before it works out column 4, so it is money the projection may count on rather than ask for.
 */
export const BUILD_WEEK_COINS = BUILD_HOURS * COINS_PER_HOUR * BUILD_WEEKS

/**
 * Column 4 is the economy and is left exactly as the sheet has it – every tier earns the same hours for the same machine. The ten-hour floor only touches the tier-1 hours figure the goal picker shows; it must never reach the pace hours, or the sheet's arithmetic stops landing on the price.
 */
export const PRINTERS: PrinterGoal[] = SHEET.map(p =>
	Object.assign({}, p, {
		coinsPerWeek: p.paceHours * COINS_PER_HOUR,
		hoursPerWeek: Math.max(TIER1_MIN_HOURS, p.hoursPerWeek),
	}),
)

export const DEFAULT_GOAL_ID = "ender-3-v3-se"

/**
 * The gentlest, which is the cheapest machine's pace. It used to gate submission; now the submit floor is the funded hours and this is only the threshold for "that starter will not fill your week" style warnings. It is read off the board rather than restated so that repricing the catalogue moves it with it.
 */
export const MIN_HOURS_PER_WEEK = Math.min(...PRINTERS.map(p => p.hoursPerWeek))

/**
 * What a design week asks of you, for a weekly earning pace and a tier.
 *
 * The pace is the whole of it: the tier only slides the funded block in or out underneath, since those hours pay for the project and earn nothing. So the ask is the pace plus however much further down tier 1's floor this tier sits.
 *
 * Trail targets are this function at the goal's own pace. One formula, so a tier cannot mean one thing on the trail and another in the submit sheet.
 */
export function weekAsk(pace: number, fundingHours: number): number {
	return pace + (fundingHours - ENTRY_TIER.fundingHours)
}

/**
 * Coins that should be earned once `weekId` is behind you, to still land the goal on time. Design weeks carry the goal's own rate; build weeks carry the flat hours everyone logs. At SEASON_WEEKS this lands exactly on the price, which is what makes it a pace rather than a guess – and what lets a big early week pay for a thin later one without anybody being warned twice.
 */
export function paceTarget(goal: PrinterGoal, weekId: number): number {
	const design = Math.min(weekId, DESIGN_WEEKS)
	const build = Math.max(0, weekId - DESIGN_WEEKS)
	return design * goal.coinsPerWeek + build * BUILD_HOURS * COINS_PER_HOUR
}

export function printerById(id: string): PrinterGoal {
	const found = PRINTERS.find(p => p.id === id) ?? PRINTERS.find(p => p.id === DEFAULT_GOAL_ID)
	if (!found) throw new Error(`no printer goal for ${id}, and ${DEFAULT_GOAL_ID} is missing from the catalogue`)
	return found
}

/**
 * Design weeks of earning still to do, at the pace that goal assumes.
 *
 * Only the design weeks are a variable. The build weeks earn BUILD_WEEK_COINS for every maker on every goal, so that much of the price is already spoken for and pacing it against the design rate would invent weeks – enough of them to run past the end of a season that is only SEASON_WEEKS long.
 */
export function weeksToGo(goal: PrinterGoal, coins: number): number {
	const fromDesign = Math.max(0, goal.coins - coins - BUILD_WEEK_COINS)
	return Math.min(DESIGN_WEEKS, Math.ceil(fromDesign / goal.coinsPerWeek))
}

/**
 * The least a week can be on a tier and still be handed in: the tier's funded block, and nothing more. Funding hours pay for the parts, so they are the whole requirement for submission – every hour worked past them only earns, it is never gate-keeping.
 *
 * That used to be funded block plus a cheapest-machine earning pace; the floor is now simply what the grant buys. This is that gate: the submit node opens here, and the submit sheet refuses a tier below it. Every screen that names a tier's requirement reads it from here, so the number you pick against is the number you are held to.
 */
export function submitFloorFor(fundingHours: number): number {
	return fundingHours
}
