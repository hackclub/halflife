import { describe, expect, test } from "bun:test"
import {
	countriesAgree,
	kitShippingTsv,
	PCB_CARD_INSTRUCTIONS,
	PCB_CARD_PURPOSE,
	starterCardCsv,
} from "@/lib/starter-funding-csv"

const origin = "https://halflife.example"

describe("starter card CSV", () => {
	test("starts with the import header, unchanged", () => {
		const csv = starterCardCsv([], origin)
		expect(csv).toBe(
			"email,amount_cents,purpose,instructions,one_time_use,pre_authorization_required,invite_message,merchant_lock,category_lock,keyword_lock,banned_merchants,banned_categories\n",
		)
	})

	test("a kit recipient's card is the PCB card, for the kit's PCB", () => {
		const csv = starterCardCsv(
			[
				{
					amountCents: 1000,
					email: "a@example.com",
					fulfilment: "KIT_WITH_PCB_CARD",
					projectId: "p1",
					title: "Starbie",
				},
			],
			origin,
		)
		const [, row] = csv.trim().split("\n")
		expect(row).toContain("a@example.com,1000,Starbie PCB,")
		expect(row).toContain(PCB_CARD_INSTRUCTIONS)
		expect(row).toContain("https://halflife.example/projects/p1")
	})

	test("a parts card is the parts card, with the project in its instructions", () => {
		const csv = starterCardCsv(
			[{ amountCents: 2990, email: "b@example.com", fulfilment: "PARTS_CARD", projectId: "p2", title: "Starbie" }],
			origin,
		)
		const [, row] = csv.trim().split("\n")
		expect(row).toContain("b@example.com,2990,Half Life parts,Parts for Starbie")
		expect(row).not.toContain(PCB_CARD_PURPOSE)
	})

	test("an instruction with a comma is quoted, so it cannot shift the columns", () => {
		const csv = starterCardCsv(
			[{ amountCents: 1000, email: "c@example.com", fulfilment: "PARTS_CARD", projectId: "p3", title: "Starbie, v2" }],
			origin,
		)
		expect(csv).toContain('"Parts for Starbie, v2 – https://halflife.example/projects/p3"')
	})

	test("without an origin, the instructions carry no link", () => {
		const csv = starterCardCsv(
			[
				{
					amountCents: 1000,
					email: "d@example.com",
					fulfilment: "KIT_WITH_PCB_CARD",
					projectId: "p4",
					title: "Starbie",
				},
			],
			null,
		)
		expect(csv).toContain(`${PCB_CARD_INSTRUCTIONS}\n`.trim())
		expect(csv).not.toContain("/projects/")
	})
})

describe("kit shipping list", () => {
	test("one tab-separated line per kit, with the verified address", () => {
		const tsv = kitShippingTsv([
			{
				city: "Austin",
				country: "US",
				email: "e@example.com",
				line1: "1 Main St",
				line2: "",
				name: "Eve Example",
				state: "TX",
				zip: "78701",
			},
		])
		expect(tsv.split("\n")[1]).toBe("Eve Example\te@example.com\t1 Main St\t\tAustin\tTX\t78701\tUS")
	})

	test("a tab or newline inside an address cannot split the row", () => {
		const tsv = kitShippingTsv([
			{
				city: "Austin",
				country: "US",
				email: "f@example.com",
				line1: "1 Main\tSt\nFlat 2",
				line2: "",
				name: "F",
				state: "TX",
				zip: "78701",
			},
		])
		expect(tsv.trim().split("\n")).toHaveLength(2)
		expect(tsv.split("\n")[1]).toContain("1 Main St Flat 2")
	})
})

describe("country check", () => {
	test("agrees when both sides name the same two-letter code, whatever the case", () => {
		expect(countriesAgree("US", "US")).toBe(true)
		expect(countriesAgree("ca", "CA")).toBe(true)
	})

	test("disagrees when they name different countries", () => {
		expect(countriesAgree("US", "CA")).toBe(false)
	})

	test("never agrees with a missing side", () => {
		expect(countriesAgree(null, "US")).toBe(false)
		expect(countriesAgree("US", null)).toBe(false)
		expect(countriesAgree("", "US")).toBe(false)
	})
})
