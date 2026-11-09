import { describe, expect, test } from "bun:test"
import { GRANT_CARD_CSV_HEADER, grantCardCsv } from "@/lib/grant-card-csv"

describe("grant card CSV", () => {
	test("writes the template header exactly", () => {
		expect(GRANT_CARD_CSV_HEADER.join(",")).toBe(
			"email,amount_cents,purpose,instructions,one_time_use,pre_authorization_required,invite_message,merchant_lock,category_lock,keyword_lock,banned_merchants,banned_categories",
		)
		expect(grantCardCsv([])).toBe(`${GRANT_CARD_CSV_HEADER.join(",")}\n`)
	})

	test("maps a row onto the template's columns", () => {
		expect(grantCardCsv([{ amountCents: 1250, email: "maker@example.com", projectId: "prj_1", title: "Bloom" }])).toBe(
			`${GRANT_CARD_CSV_HEADER.join(",")}\n`
				+ "maker@example.com,1250,Half Life parts – HL:prj_1,Parts funding for Bloom.,false,false,Your Half Life parts grant is ready. Accept it to get your card.,,,,,\n",
		)
	})

	test("quotes a title that holds a comma or quote so no column shifts", () => {
		const csv = grantCardCsv([
			{ amountCents: 500, email: "m@example.com", projectId: "p2", title: 'Gadget, the "deluxe"' },
		])
		const [, line] = csv.split("\n")
		expect(line).toContain('"Parts funding for Gadget, the ""deluxe""."')
	})

	test("keeps one row per project in the order it was prepared", () => {
		const csv = grantCardCsv([
			{ amountCents: 100, email: "a@example.com", projectId: "p1", title: "First" },
			{ amountCents: 200, email: "b@example.com", projectId: "p2", title: "Second" },
		])
		const lines = csv.trimEnd().split("\n")
		expect(lines).toHaveLength(3)
		expect(lines[1]).toStartWith("a@example.com,100,")
		expect(lines[2]).toStartWith("b@example.com,200,")
	})
})
