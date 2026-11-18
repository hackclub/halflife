import { describe, expect, test } from "bun:test"
import type { GrantDisbursement } from "@/lib/hcb"
import { bareGrantId, bufferTopUpKey, selectBufferTopUps } from "@/lib/hcb-buffer-topups"

const disbursement = (overrides: Partial<GrantDisbursement> = {}): GrantDisbursement => ({
	amountCents: 200,
	createdAt: "2026-11-14T19:11:39.123Z",
	memo: "Topup of grant to Polo",
	transactionId: "txn_1",
	...overrides,
})

describe("buffer top-ups", () => {
	test("the card grant id prefix is ignored, so both spellings of one grant match", () => {
		expect(bareGrantId("cdg_DZIKLV")).toBe("DZIKLV")
		expect(bareGrantId("DZIKLV")).toBe("DZIKLV")
	})

	test("a disbursement is identified by its grant, time, amount and memo", () => {
		expect(bufferTopUpKey("cdg_DZIKLV", disbursement())).toBe(
			"DZIKLV|2026-11-14T19:11:39.123Z|200|Topup of grant to Polo",
		)
		expect(bufferTopUpKey("cdg_DZIKLV", disbursement({ createdAt: null, memo: null }))).toBe("DZIKLV||200|")
	})

	test("a manual top-up on the grant is a buffer top-up", () => {
		expect(selectBufferTopUps([disbursement()], [], "cdg_DZIKLV")).toHaveLength(1)
	})

	test("the original grant, returns and withdrawals are not buffer top-ups", () => {
		const rows = [
			disbursement({ amountCents: 9937, memo: "Grant to Polo" }),
			disbursement({ amountCents: -467, memo: "Returning canceled grant to James" }),
			disbursement({ amountCents: 2711, memo: "Return of funds from grant to zoeygandhi" }),
			disbursement({ amountCents: -10, memo: "Topup of grant to Polo" }),
		]
		expect(selectBufferTopUps(rows, [], "cdg_1")).toHaveLength(0)
	})

	test("a top-up Half Life sent is a payment, not a buffer top-up", () => {
		const sent = [{ amountCents: 200, grantHashid: "DZIKLV" }]
		expect(selectBufferTopUps([disbursement()], sent, "cdg_DZIKLV")).toHaveLength(0)
	})

	test("a site top-up of a different amount on the same grant is still a buffer top-up", () => {
		const sent = [{ amountCents: 500, grantHashid: "DZIKLV" }]
		expect(selectBufferTopUps([disbursement()], sent, "cdg_DZIKLV")).toHaveLength(1)
	})
})
