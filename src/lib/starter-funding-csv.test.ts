import { describe, expect, test } from "bun:test"
import { GRANT_CARD_CSV_HEADER } from "@/lib/grant-card-csv"
import { GRANT_CARD_INVITE_MESSAGE } from "@/lib/grant-card-policy"
import { starterCardCsv } from "@/lib/starter-funding-csv"

const origin = "https://halflife.hackclub.com"

describe("starter card CSV", () => {
	test("an empty batch is just the header", () => {
		expect(starterCardCsv([], origin)).toBe(`${GRANT_CARD_CSV_HEADER.join(",")}\n`)
	})

	test("a new card is the parts + PCB grant, with the same purpose as every other card", () => {
		const csv = starterCardCsv(
			[{ amountCents: 3300, email: "a@example.com", projectId: "prj_1", title: "Starbie" }],
			origin,
		)
		const [, row] = csv.trim().split("\n")
		expect(row).toContain("a@example.com,3300,Half Life parts,")
		expect(row).not.toContain("Starbie PCB")
	})

	test("the instructions link to the maker's project", () => {
		const csv = starterCardCsv(
			[{ amountCents: 1000, email: "a@example.com", projectId: "prj_1", title: "Starbie" }],
			origin,
		)
		expect(csv).toContain(`${origin}/projects/prj_1`)
	})

	test("every row carries the shared invite message", () => {
		const csv = starterCardCsv(
			[{ amountCents: 1000, email: "a@example.com", projectId: "prj_1", title: "Starbie" }],
			origin,
		)
		expect(csv).toContain(GRANT_CARD_INVITE_MESSAGE)
	})
})
