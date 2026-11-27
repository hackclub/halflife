import { describe, expect, test } from "bun:test"
import {
	type CardGrantExpectation,
	cardGrantCreateBody,
	type HcbCardGrantList,
	type HcbCardGrantSummary,
	purposeMatches,
	reconcileCardGrantIssue,
} from "@/lib/hcb"

const attemptedAt = new Date("2026-10-29T12:00:00.000Z")
const expected: CardGrantExpectation = {
	amountCents: 3050,
	attemptedAt,
	email: "Maker@Example.com",
	purpose: "Half Life parts – HL:prj_123",
}

function grant(overrides: Partial<HcbCardGrantSummary> = {}): HcbCardGrantSummary {
	return {
		allowedMerchants: [],
		amountCents: 3050,
		cardId: "card_1",
		createdAt: "2026-10-29T12:00:05.000Z",
		email: "maker@example.com",
		id: "cdg_1",
		merchantLock: [],
		ownerId: null,
		purpose: "Half Life parts – HL:prj_123",
		status: "active",
		...overrides,
	}
}

function listed(rows: HcbCardGrantSummary[]): HcbCardGrantList {
	return { kind: "listed", rows }
}

describe("reconcileCardGrantIssue", () => {
	test("finds the one grant the attempt created", () => {
		expect(reconcileCardGrantIssue(listed([grant()]), expected)).toEqual({ grantId: "cdg_1", kind: "landed" })
	})

	test("no match means the attempt did not create anything", () => {
		expect(reconcileCardGrantIssue(listed([]), expected)).toEqual({ kind: "absent" })
		expect(reconcileCardGrantIssue(listed([grant({ purpose: "Something else" })]), expected)).toEqual({
			kind: "absent",
		})
	})

	test("a grant from before the attempt is not this attempt", () => {
		expect(reconcileCardGrantIssue(listed([grant({ createdAt: "2026-10-29T11:00:00.000Z" })]), expected)).toEqual({
			kind: "absent",
		})
	})

	test("two matching grants are ambiguous, never a double click", () => {
		expect(reconcileCardGrantIssue(listed([grant(), grant({ id: "cdg_2" })]), expected)).toEqual({ kind: "ambiguous" })
	})

	test("an unreadable list fails closed", () => {
		expect(reconcileCardGrantIssue({ kind: "unreadable" }, expected)).toEqual({ kind: "ambiguous" })
	})

	test("a matching row without a usable timestamp is ambiguous", () => {
		expect(reconcileCardGrantIssue(listed([grant({ createdAt: null })]), expected)).toEqual({
			kind: "ambiguous",
		})
	})

	test("a grant whose owner HCB would not name is ambiguous, never absent", () => {
		expect(reconcileCardGrantIssue(listed([grant({ email: null })]), expected)).toEqual({ kind: "ambiguous" })
	})

	test("this project's marker under a different owner is ambiguous", () => {
		expect(reconcileCardGrantIssue(listed([grant({ email: "someone@example.com" })]), expected)).toEqual({
			kind: "ambiguous",
		})
	})

	test("a matching amount and owner without the marker is ambiguous", () => {
		expect(reconcileCardGrantIssue(listed([grant({ purpose: null })]), expected)).toEqual({ kind: "ambiguous" })
	})

	test("another project's titled grant is not this attempt", () => {
		// Two of a maker's cards at the same tier are the same amount, so a title that differs is a different card.
		const titled = { ...expected, purpose: "Half Life parts – Lamp" }
		expect(reconcileCardGrantIssue(listed([grant({ purpose: "Half Life parts – Clock" })]), titled)).toEqual({
			kind: "absent",
		})
	})

	test("a grant already recorded against another row cannot confirm this one", () => {
		expect(reconcileCardGrantIssue(listed([grant()]), expected, new Set(["1"]))).toEqual({ kind: "absent" })
		expect(reconcileCardGrantIssue(listed([grant()]), expected, new Set(["cdg_1"]))).toEqual({ kind: "absent" })
	})

	test("a title-less legacy attempt still reconciles through the prefix", () => {
		const legacy = { ...expected, purpose: "Half Life parts" }
		expect(reconcileCardGrantIssue(listed([grant()]), legacy)).toEqual({ grantId: "cdg_1", kind: "landed" })
	})
})

describe("purposeMatches", () => {
	test("a bare prize line catches a prize-titled card and a legacy parts-titled one", () => {
		expect(purposeMatches("Half Life prize – Soldering kit", "Half Life prize")).toBe(true)
		expect(purposeMatches("Half Life parts – Soldering kit", "Half Life prize")).toBe(true)
	})

	test("a titled purpose still matches only itself", () => {
		expect(purposeMatches("Half Life prize – Clock", "Half Life prize – Lamp")).toBe(false)
	})
})

describe("cardGrantCreateBody", () => {
	const input = {
		amountCents: 3050,
		email: "maker@example.com",
		instructions: "Order #12: Soldering kit",
		inviteMessage: "Your Half Life shop grant is ready.",
		purpose: "Soldering kit",
	}

	test("joins the merchant allowlist into the comma-separated string HCB accepts", () => {
		expect(cardGrantCreateBody({ ...input, merchantIds: ["AAAPLASTIC", "BBBHARDWARE"] }).merchant_lock).toBe(
			"AAAPLASTIC,BBBHARDWARE",
		)
	})

	test("omits the lock entirely when the card is unrestricted", () => {
		expect(cardGrantCreateBody(input)).not.toHaveProperty("merchant_lock")
		expect(cardGrantCreateBody({ ...input, merchantIds: [] })).not.toHaveProperty("merchant_lock")
	})
})

describe("reconcileCardGrantIssue with a merchant lock", () => {
	const locked = { ...expected, merchantIds: ["AAAPLASTIC", "BBBHARDWARE"] }

	test("the grant carrying the same allowlist is the attempt", () => {
		const row = grant({ merchantLock: ["BBBHARDWARE", "AAAPLASTIC"] })
		expect(reconcileCardGrantIssue(listed([row]), locked)).toEqual({ grantId: "cdg_1", kind: "landed" })
	})

	test("a grant with a different allowlist is a different card", () => {
		expect(reconcileCardGrantIssue(listed([grant({ merchantLock: ["AAAPLASTIC"] })]), locked)).toEqual({
			kind: "absent",
		})
	})

	test("a grant whose lock HCB did not report is ambiguous, never absent", () => {
		expect(reconcileCardGrantIssue(listed([grant({ merchantLock: null })]), locked)).toEqual({ kind: "ambiguous" })
	})

	test("an unrestricted attempt is confirmed by an unrestricted grant, and not by a locked one", () => {
		const unrestricted = { ...expected, merchantIds: [] }
		expect(reconcileCardGrantIssue(listed([grant({ merchantLock: [] })]), unrestricted)).toEqual({
			grantId: "cdg_1",
			kind: "landed",
		})
		expect(reconcileCardGrantIssue(listed([grant({ merchantLock: ["AAAPLASTIC"] })]), unrestricted)).toEqual({
			kind: "absent",
		})
	})
})
