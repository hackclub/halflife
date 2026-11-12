import { describe, expect, test } from "bun:test"
import { type ConfirmTarget, parseConfirmedTotals, refusedTotal } from "@/lib/starter-funding-confirm"

const target = (overrides: Partial<ConfirmTarget> = {}): ConfirmTarget => ({
	email: "a@example.com",
	fundingGivenCents: 1000,
	recordedCents: 1000,
	targetCents: 3300,
	...overrides,
})

const row = (totalCents: number, email = "a@example.com") => ({ email, projectId: "prj_1", totalCents })

describe("parsing the confirmed totals", () => {
	test("reads each row with the amount in cents and the email lower-cased", () => {
		const { problems, rows } = parseConfirmedTotals("email,project_id,hcb_total_usd\nA@Example.com,prj_1,27.11\n")
		expect(problems).toEqual([])
		expect(rows).toEqual([{ email: "a@example.com", projectId: "prj_1", totalCents: 2711 }])
	})

	test("refuses a file without the exact header", () => {
		expect(parseConfirmedTotals("email,project,total\n").problems.length).toBe(1)
	})

	test("reports a malformed amount rather than guessing", () => {
		const { problems, rows } = parseConfirmedTotals("email,project_id,hcb_total_usd\na@example.com,prj_1,twenty\n")
		expect(rows).toEqual([])
		expect(problems[0]).toContain("not a dollar amount")
	})

	test("reports a row with the wrong number of columns", () => {
		const { problems } = parseConfirmedTotals("email,project_id,hcb_total_usd\na@example.com,prj_1\n")
		expect(problems[0]).toContain("expected email,project_id,hcb_total_usd")
	})
})

describe("refusing a confirmed total", () => {
	test("a total up to the target is recorded", () => {
		expect(refusedTotal(row(3300), target())).toBeNull()
		expect(
			refusedTotal(row(2711), target({ fundingGivenCents: 2711, recordedCents: 2711, targetCents: 2711 })),
		).toBeNull()
	})

	test("a total above the target is refused", () => {
		expect(refusedTotal(row(3301), target())).toBe("above the parts + PCB target")
	})

	test("a card that would go down on the site is refused", () => {
		expect(refusedTotal(row(900), target({ fundingGivenCents: 0, recordedCents: 1000 }))).toBe(
			"below the card already recorded on the site",
		)
	})

	test("a total below what Funding given records is refused", () => {
		expect(refusedTotal(row(1000), target({ fundingGivenCents: 2711, recordedCents: null }))).toBe(
			"below what Funding given already records",
		)
	})

	test("a row for someone other than the project's owner is refused", () => {
		expect(refusedTotal(row(3300, "b@example.com"), target())).toBe("the email does not match the project's owner")
	})
})
