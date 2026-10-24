import "dotenv/config"
import { PRINTERS } from "../src/lib/config/printers"
import { ShopItemCategory } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { formatDbTimestamp } from "../src/lib/time"

/**
 * Idempotent: `./dev.sh` runs it on every start, and it is safe to run against
 * production to add newly defined shop items.
 */
async function main() {
	const startDate = process.env.PROGRAM_START_DATE ?? "2026-10-05"

	const settings = await db.orm.public.ProgramSettings.upsert({
		create: {
			eventStartDate: formatDbTimestamp(new Date(`${startDate}T00:00:00.000Z`)),
			id: "singleton",
			programTimezone: process.env.PROGRAM_TIMEZONE ?? "America/New_York",
		},
		// Never clobber settings an admin has already changed.
		update: {},
	})
	console.log(`program settings: start ${settings.eventStartDate.slice(0, 10)}`)

	const items = [
		// ── Printers ─────────────────────────────────────────────────────────────
		// Generated from the goal catalogue rather than typed out here, because the
		// catalogue IS the budget spreadsheet: a machine's price, the hours a design
		// week has to bank to reach it, and what the shop charges for it all have to
		// be the same number. Typing them separately is how someone ends up saving
		// for 219 coins against a shelf tag that says 250.
		//
		// `requiresPrinterQualified` is false: you buy a printer with coins you
		// earned, and every week's submit floor is sized so the cheapest one stays
		// reachable. Upgrades are the things gated on finishing.
		...PRINTERS.map((printer, index) => ({
			category: ShopItemCategory.PRINTER,
			description: printer.blurb,
			id: `printer-${printer.id}`,
			name: printer.name,
			priceCredits: printer.coins,
			requiresPrinterQualified: false,
			sortOrder: index + 1,
		})),

		// ── Upgrades and consumables ─────────────────────────────────────────────
		{
			category: ShopItemCategory.PRINTER_UPGRADE,
			description: "Keeps the heat in and the noise down. Fits the stock frame.",
			id: "printer-enclosure",
			name: "Printer enclosure",
			priceCredits: 120,
			sortOrder: 10,
		},
		{
			category: ShopItemCategory.PRINTER_UPGRADE,
			description: "For abrasive filaments — carbon fibre, glow-in-the-dark, wood fill.",
			id: "hardened-nozzle",
			name: "Hardened steel nozzle",
			priceCredits: 40,
			sortOrder: 20,
		},
		{
			category: ShopItemCategory.CONSUMABLE,
			description: "Three 1kg spools in colours of your choosing.",
			id: "filament-bundle",
			maxPerUser: 3,
			name: "Filament bundle",
			priceCredits: 60,
			sortOrder: 30,
		},
		{
			category: ShopItemCategory.PRINTER_UPGRADE,
			description: "A spare plate so a failed print does not stop the next one.",
			id: "build-plate",
			name: "Textured PEI build plate",
			priceCredits: 35,
			sortOrder: 40,
		},
	]

	for (const item of items)
		await db.orm.public.ShopItem.upsert({
			create: item,
			// Price and stock are edited from the admin UI; do not overwrite them.
			update: { description: item.description, name: item.name, sortOrder: item.sortOrder },
		})

	/**
	 * Retire printers that have left the catalogue.
	 *
	 * This seed only ever added rows, which was fine while the printers were
	 * typed out here and never changed. Now that they are generated from the
	 * budget sheet, re-pricing one changes its id — and without this the shop
	 * ends up selling a Bambu A1 Mini at 250 coins next to a Bambu A1 Mini at
	 * 241, with the participant's goal tracker pointed at neither.
	 *
	 * Deactivated, never deleted: a ShopOrder points at its item, and someone's
	 * order history must not stop making sense because a machine was re-priced.
	 */
	const live = new Set(items.map(item => item.id))
	const retired = await db.orm.public.ShopItem.where({ active: true, category: ShopItemCategory.PRINTER })
		.where(item => item.id.notIn([...live]))
		.updateAndCount({ active: false })

	console.log(
		`shop items: ${items.length} present${retired > 0 ? `, ${retired} off-catalogue printer(s) retired` : ""}`,
	)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exit(1)
} finally {
	await db.close()
}
