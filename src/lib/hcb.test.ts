import { describe, expect, test } from "bun:test"
import {
	type CardGrantExpectation,
	type HcbCardGrantList,
	type HcbCardGrantSummary,
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
		amountCents: 3050,
		cardId: "card_1",
		createdAt: "2026-10-29T12:00:05.000Z",
		email: "maker@example.com",
		id: "cdg_1",
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
})
