import { describe, expect, test } from "bun:test"
import type { GrantDisbursement } from "@/lib/hcb"
import {
	bareGrantId,
	bufferTopUpKey,
	fundsReturn,
	grantReturn,
	grantReturnedAt,
	memoKind,
	returnedBy,
	selectBufferTopUps,
} from "@/lib/hcb-buffer-topups"

const disbursement = (overrides: Partial<GrantDisbursement> = {}): GrantDisbursement => ({
	amountCents: 200,
	createdAt: "2026-11-14T19:11:39.123Z",
	memo: "Topup of grant to Polo",
	senderEmail: null,
	transactionId: "txn_1",
	...overrides,
})

describe("grantReturn", () => {
	test("an expired grant's return is found, but is not a hand-back", () => {
		const found = grantReturn([
			disbursement({ createdAt: "2026-12-01T00:00:00.000Z", memo: "Returning expired grant to Ellie" }),
		])
		expect(found?.expired).toBe(true)
		expect(grantReturnedAt([disbursement({ memo: "Returning expired grant to Ellie" })])).toBeNull()
	})

	test("a hand-back wins over an expiry on the same grant", () => {
		const found = grantReturn([
			disbursement({ createdAt: "2026-12-01T00:00:00.000Z", memo: "Returning expired grant to Ellie" }),
			disbursement({ createdAt: "2026-11-19T10:00:00.000Z", memo: "Returning canceled grant to Ellie" }),
		])
		expect(found?.expired).toBe(false)
		expect(found?.disbursement.createdAt).toBe("2026-11-19T10:00:00.000Z")
	})
})

describe("returnedBy", () => {
	test("the grant's own email is the maker", () => {
		expect(returnedBy("Maker@Example.com", "maker@example.com")).toBe("maker")
	})

	test("another sender is other, and no sender is unknown", () => {
		expect(returnedBy("hcb-system@example.com", "maker@example.com")).toBe("other")
		expect(returnedBy(null, "maker@example.com")).toBe("unknown")
	})
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
		// With no time and no transaction id, the position keeps two otherwise identical rows apart.
		expect(bufferTopUpKey("cdg_DZIKLV", disbursement({ createdAt: null, memo: null, transactionId: null }), 0)).toBe(
			"DZIKLV||200||0",
		)
		expect(bufferTopUpKey("cdg_DZIKLV", disbursement({ createdAt: null, memo: null, transactionId: null }), 1)).toBe(
			"DZIKLV||200||1",
		)
		// A transaction id distinguishes the row even without a time.
		expect(bufferTopUpKey("cdg_DZIKLV", disbursement({ createdAt: null, memo: null }))).toBe("DZIKLV||200||txn_1")
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

	test("a payment explains one disbursement, not every disbursement of that amount", () => {
		const sent = [{ amountCents: 200, grantHashid: "DZIKLV", transactionId: "txn_1" }]
		const rows = [disbursement(), disbursement({ transactionId: "txn_2" })]
		expect(selectBufferTopUps(rows, sent, "cdg_DZIKLV")).toHaveLength(1)
	})

	test("a transaction id pairs exactly, even when another payment has the same amount", () => {
		const sent = [
			{ amountCents: 200, grantHashid: "DZIKLV", transactionId: "txn_9" },
			{ amountCents: 200, grantHashid: "DZIKLV", transactionId: "txn_1" },
		]
		expect(selectBufferTopUps([disbursement()], sent, "cdg_DZIKLV")).toHaveLength(0)
	})
})

describe("grantReturnedAt", () => {
	test("the balance going back to the organisation is a return", () => {
		const rows = [
			disbursement({ amountCents: 6432, memo: "Grant to Ellie" }),
			// HCB's API gives the amount unsigned; the memo carries the direction.
			disbursement({
				amountCents: 6432,
				createdAt: "2026-11-19T10:00:00.000Z",
				memo: "Returning canceled grant to Ellie",
			}),
		]
		expect(grantReturnedAt(rows)).toBe("2026-11-19T10:00:00.000Z")
	})

	test("a grant that was not returned has no return time", () => {
		const rows = [
			disbursement({ amountCents: 6432, memo: "Grant to Ellie" }),
			disbursement({ amountCents: 200, memo: "Topup of grant to Ellie" }),
			disbursement({ amountCents: -5, memo: "Purchase at Adafruit" }),
		]
		expect(grantReturnedAt(rows)).toBeNull()
	})

	test("a return without a time is not treated as a return", () => {
		expect(
			grantReturnedAt([
				disbursement({ amountCents: 6432, createdAt: null, memo: "Returning canceled grant to Ellie" }),
			]),
		).toBeNull()
	})
})

describe("memoKind", () => {
	test("drops the name after to or from, and keeps the kind", () => {
		expect(memoKind("Grant to Ellie")).toBe("Grant")
		expect(memoKind("Returning canceled grant to Max Lin")).toBe("Returning canceled grant")
		expect(memoKind("Withdrawal from grant to Polo")).toBe("Withdrawal")
		expect(memoKind("AliExpress")).toBe("AliExpress")
		expect(memoKind(null)).toBe("no memo")
	})
})

describe("fundsReturn", () => {
	test("a balance returned under HCB's funds memo is found, and a hand-back is not one", () => {
		expect(
			fundsReturn([disbursement({ amountCents: 2711, memo: "Return of funds from grant to Zoe" })])?.amountCents,
		).toBe(2711)
		expect(fundsReturn([disbursement({ memo: "Returning canceled grant to Zoe" })])).toBeNull()
	})
})
