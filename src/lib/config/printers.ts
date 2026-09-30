/**
 * The grand-prize catalogue — the thing every banked coin is aimed at.
 *
 * Numbers come straight from the budget sheet (Half life budget – Printers),
 * and nothing here is invented on top of them. One coin is one dollar, so a
 * machine costs its shop price. Banked hours a week are the sheet's column 4:
 *
 *   banked = (shopPrice - 5 hours * 5 build weeks * $5) / 5 design weeks / $5
 *
 * Read the shape of that formula, because every projection below depends on
 * it: the season is ten weeks, and the two halves bank differently. The five
 * build weeks are the same five hours for everyone and none of them is funded,
 * so they hand every maker the same flat BUILD_WEEK_COINS whatever machine
 * they picked. Only the remainder is paced against the design weeks, and there
 * are five of those. A projection that charges the whole price to the design
 * rate asks for weeks the season does not have.
 *
 * Those banked hours are the same whatever tier you are on — the tier decides
 * how many funded hours sit underneath them, not how much you bank.
 */
import { BUILD_HOURS, COINS_PER_HOUR, DESIGN_WEEKS, TOTAL_WEEKS } from "./program"
import { ENTRY_TIER } from "./tiers"

export type PrinterKind = "bedslinger" | "corexy" | "resin" | "cnc"

export interface PrinterGoal {
  id: string
  name: string
  /** Sticker price, before anyone ships anything. */
  price: number
  /** What it actually costs us — shipping and tax included. */
  shopPrice: number
  /** What it costs in the shop. One coin is one dollar. */
  coins: number
  /** Hours a design week asks on tier 1 to land this by the end of the season. */
  hoursPerWeek: number
  /** Of those hours, the ones that bank instead of funding your project. */
  bankedHours: number
  /**
   * Coins a design week earns at that pace — banked hours at $5 each. A build
   * week does not use this; it banks BUILD_WEEK_COINS / BUILD_WEEKS flat.
   */
  coinsPerWeek: number
  kind: PrinterKind
  link: string
  /** Short flag for anything that is not a plain FDM printer. */
  note?: string
  /** How the maker describes it on the product page `link` points at. */
  blurb: string
}

/**
 * Nobody is asked for less than ten hours a week on tier 1. The cheapest
 * machine works out at 9.76 on the budget sheet, so it is held here at the
 * floor; every other goal already clears it on its own.
 */
export const TIER1_MIN_HOURS = 10

/** The sheet as typed, minus the one column that is derived from another. */
type SheetRow = Omit<PrinterGoal, "coinsPerWeek">

const SHEET: SheetRow[] = [
  {
    id: "ender-3-v3-se",
    name: "Ender 3 V3 SE",
    price: 199,
    shopPrice: 218.9,
    coins: 219,
    hoursPerWeek: 9.76,
    bankedHours: 3.76,
    kind: "bedslinger",
    link: "https://store.creality.com/products/ender-3-v3-se-3d-printer",
    blurb: "Perfect for beginners: easy, reliable, and ready for every project.",
  },
  {
    id: "bambu-a1-mini",
    name: "Bambu A1 Mini",
    price: 219,
    shopPrice: 240.9,
    coins: 241,
    hoursPerWeek: 10.64,
    bankedHours: 4.64,
    kind: "bedslinger",
    link: "https://us.store.bambulab.com/products/a1-mini",
    blurb: "Ultimate performance in a compact build volume, with features once found only in high-end models.",
  },
  {
    id: "elegoo-mars-4",
    name: "ELEGOO Mars 5",
    price: 225,
    shopPrice: 247.5,
    coins: 248,
    hoursPerWeek: 10.9,
    bankedHours: 4.9,
    kind: "resin",
    note: "Resin",
    link: "https://us.elegoo.com/collections/lcd-printers/products/mars-5-4k-6-6inch-monochrome-lcd-resin-3d-printer",
    blurb: "The best resin 3D printer for budget-savvy beginners, with smart self-check and auto-leveling.",
  },
  {
    id: "elegoo-neptune-4",
    name: "ELEGOO Neptune 4",
    price: 249,
    shopPrice: 273.9,
    coins: 274,
    hoursPerWeek: 11.96,
    bankedHours: 5.96,
    kind: "bedslinger",
    link: "https://us.elegoo.com/collections/fdm-printers/products/elegoo-neptune-4-fdm-3d-printer",
    blurb: "Up to 500mm/s printing, 121-point auto bed leveling and a 300°C dual-gear direct extruder.",
  },
  {
    id: "monoprice-cnc",
    name: "Monoprice CNC Router",
    price: 249.99,
    shopPrice: 274.99,
    coins: 275,
    hoursPerWeek: 12,
    bankedHours: 6,
    kind: "cnc",
    note: "CNC Router",
    link: "https://www.monoprice.com/product?p_id=44220",
    blurb: "A 3-axis CNC router for engraving and milling soft metals, wood, plastic, acrylic, PVC and PCBs.",
  },
  {
    id: "elegoo-centauri-2",
    name: "ELEGOO Centauri 2",
    price: 299,
    shopPrice: 328.9,
    coins: 329,
    hoursPerWeek: 14.16,
    bankedHours: 8.16,
    kind: "corexy",
    link: "https://us.elegoo.com/collections/fdm-printers/products/centauri-2",
    blurb: "A high-speed CoreXY 3D printer with easy setup, smart auto-calibration and reliable precision.",
  },
  {
    id: "bambu-a1",
    name: "Bambu A1",
    price: 299,
    shopPrice: 328.9,
    coins: 329,
    hoursPerWeek: 14.16,
    bankedHours: 8.16,
    kind: "bedslinger",
    link: "https://us.store.bambulab.com/products/a1",
    blurb: "Fully automated, multi-color printing: a full-size bed-slinger with CoreXY speed.",
  },
  {
    id: "bambu-p1s",
    name: "Bambu P1S",
    price: 399,
    shopPrice: 438.9,
    coins: 439,
    hoursPerWeek: 18.56,
    bankedHours: 12.56,
    kind: "corexy",
    link: "https://us.store.bambulab.com/products/p1s",
    blurb: "A high-speed enclosed 3D printer with a CoreXY design and reliable performance right out of the box.",
  },
]

/**
 * The coins one banked hour is worth — the sheet's $5, at a coin to the dollar.
 * Re-exported rather than restated so the catalogue and the ledger cannot
 * disagree about what an hour is worth.
 */
export { COINS_PER_HOUR }

/** The season, counted off the program schedule rather than restated here. */
export const SEASON_WEEKS = TOTAL_WEEKS
export const BUILD_WEEKS = TOTAL_WEEKS - DESIGN_WEEKS
export { DESIGN_WEEKS }

/**
 * What the build half banks for everyone, whichever machine is on the wall:
 * BUILD_HOURS a week, none of it funded, at COINS_PER_HOUR. This is the
 * `5 hours * 5 build weeks * $5` term the sheet subtracts before it works out
 * column 4, so it is money the projection may count on rather than ask for.
 */
export const BUILD_WEEK_COINS = BUILD_HOURS * COINS_PER_HOUR * BUILD_WEEKS

/**
 * Column 4 is the economy and is left exactly as the sheet has it — every tier
 * banks the same hours for the same machine. The ten-hour floor only touches
 * the tier-1 hours figure the goal picker shows; it must never reach the
 * banked hours, or the sheet's arithmetic stops landing on the price.
 */
export const PRINTERS: PrinterGoal[] = SHEET.map((p) => ({
  ...p,
  hoursPerWeek: Math.max(TIER1_MIN_HOURS, p.hoursPerWeek),
  coinsPerWeek: p.bankedHours * COINS_PER_HOUR,
}))

export const DEFAULT_GOAL_ID = "ender-3-v3-se"

/** The steepest weekly commitment on the board — the scale everything else reads against. */
export const MAX_HOURS_PER_WEEK = Math.max(...PRINTERS.map((p) => p.hoursPerWeek))

/**
 * The gentlest, which is the cheapest machine's pace — and so the floor under
 * every design week whatever is taped to the wall. Bank less than this and the
 * season cannot end in a printer at all, which is the one outcome the program
 * does not offer; a week short of it is not a week that can be handed in.
 *
 * It is TIER1_MIN_HOURS by construction, since the floor is what lifts the
 * cheapest machine to ten, but it is read off the board rather than restated
 * so that repricing the catalogue moves the gate with it.
 */
export const MIN_HOURS_PER_WEEK = Math.min(...PRINTERS.map((p) => p.hoursPerWeek))

/**
 * What a design week asks of you, for a weekly banking pace and a tier.
 *
 * The pace is the whole of it: the tier only slides the funded block in or out
 * underneath, since those hours pay for the project and bank nothing. So the
 * ask is the pace plus however much further down tier 1's floor this tier sits.
 *
 * Every hours figure in the app is this function with a different pace — the
 * goal's own pace for the target, MIN_HOURS_PER_WEEK for the floor that keeps
 * the cheapest machine reachable. One formula, so a tier cannot mean one thing
 * on the trail and another in the submit sheet.
 */
export function weekAsk(pace: number, fundingHours: number): number {
  return pace + (fundingHours - ENTRY_TIER.fundingHours)
}

/**
 * Coins that should be banked once `weekId` is behind you, to still land the
 * goal on time. Design weeks carry the goal's own rate; build weeks carry the
 * flat hours everyone logs. At SEASON_WEEKS this lands exactly on the price,
 * which is what makes it a pace rather than a guess — and what lets a big
 * early week pay for a thin later one without anybody being warned twice.
 */
export function paceTarget(goal: PrinterGoal, weekId: number): number {
  const design = Math.min(weekId, DESIGN_WEEKS)
  const build = Math.max(0, weekId - DESIGN_WEEKS)
  return design * goal.coinsPerWeek + build * BUILD_HOURS * COINS_PER_HOUR
}

export function printerById(id: string): PrinterGoal {
  return PRINTERS.find((p) => p.id === id) ?? PRINTERS.find((p) => p.id === DEFAULT_GOAL_ID)!
}

/**
 * Design weeks of banking still to do, at the pace that goal assumes.
 *
 * Only the design weeks are a variable. The build weeks bank BUILD_WEEK_COINS
 * for every maker on every goal, so that much of the price is already spoken
 * for and pacing it against the design rate would invent weeks — enough of
 * them to run past the end of a season that is only SEASON_WEEKS long.
 */
export function weeksToGo(goal: PrinterGoal, coins: number): number {
  const fromDesign = Math.max(0, goal.coins - coins - BUILD_WEEK_COINS)
  return Math.min(DESIGN_WEEKS, Math.ceil(fromDesign / goal.coinsPerWeek))
}

/**
 * The least a week can be on a tier and still be handed in: the tier's funded
 * block, plus the banking the cheapest machine needs sitting on top of it.
 *
 * The two halves are not the same kind of hour, which is the whole reason this
 * exists. Tier 2 funds thirteen, and not one of those thirteen banks a coin —
 * so a tier 2 week is not seventeen hours of one thing, it is thirteen that
 * pay for the project and four that pay for the printer. A tier picker that
 * quotes only the funded block is quoting the smaller of two numbers as though
 * it were the gate.
 *
 * This is that gate: the submit node opens here, and the submit sheet refuses
 * a tier below it. Every screen that names a tier's hours reads it from here,
 * so the number you pick against is the number you are held to.
 */
export function submitFloorFor(fundingHours: number): number {
  return weekAsk(MIN_HOURS_PER_WEEK, fundingHours)
}

/** Of that floor, the part that banks toward the goal rather than the project. */
export function tierBankedFloor(fundingHours: number): number {
  return submitFloorFor(fundingHours) - fundingHours
}

/** What a design week at this tier asks of someone saving for this machine. */
export function weekAskFor(goal: PrinterGoal, fundingHours: number): number {
  return weekAsk(goal.hoursPerWeek, fundingHours)
}
