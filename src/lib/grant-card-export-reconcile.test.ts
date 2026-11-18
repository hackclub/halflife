import { describe, expect, test } from "bun:test"
import { type ExportRowForReconcile, isHalfLifePurpose, reconcileExportRows } from "@/lib/grant-card-export-reconcile"
import type { HcbCardGrantSummary } from "@/lib/hcb"

const row = (id: string, overrides: Partial<ExportRowForReconcile> = {}): ExportRowForReconcile => ({
	amountCents: 3050,
	email: "maker@example.com",
	id,
	...overrides,
})

function grant(overrides: Partial<HcbCardGrantSummary> = {}): HcbCardGrantSummary {
	return {
		amountCents: 3050,
		cardId: null,
		createdAt: "2026-10-29T12:00:05.000Z",
		email: "maker@example.com",
		id: "cdg_1",
		purpose: "Half Life parts – Robot arm",
		status: "active",
		...overrides,
	}
}

const none = new Set<string>()

describe("reconcileExportRows", () => {
	test("a row is landed when HCB holds a grant for its maker and amount", () => {
		expect(reconcileExportRows([row("r1")], [grant()], none).verdicts.map(v => v.kind)).toEqual(["landed"])
	})

	test("maker emails match regardless of case and surrounding space", () => {
		const result = reconcileExportRows([row("r1", { email: " Maker@Example.com " })], [grant()], none)
		expect(result.verdicts[0]?.kind).toBe("landed")
	})

	test("a row is missing when no grant has its maker and amount", () => {
		expect(reconcileExportRows([row("r1")], [], none).verdicts[0]?.kind).toBe("missing")
		expect(reconcileExportRows([row("r1")], [grant({ amountCents: 2000 })], none).verdicts[0]?.kind).toBe("missing")
		expect(reconcileExportRows([row("r1")], [grant({ email: "other@example.com" })], none).verdicts[0]?.kind).toBe(
			"missing",
		)
	})

	test("a canceled grant pays nothing, so it cannot confirm a row", () => {
		expect(reconcileExportRows([row("r1")], [grant({ status: "canceled" })], none).verdicts[0]?.kind).toBe("missing")
	})

	test("a grant Half Life already tracks through the API cannot be the CSV's payment", () => {
		expect(reconcileExportRows([row("r1")], [grant({ id: "cdg_api" })], new Set(["cdg_api"])).verdicts[0]?.kind).toBe(
			"missing",
		)
	})

	test("a grant with another purpose is not one of ours", () => {
		expect(reconcileExportRows([row("r1")], [grant({ purpose: "Bike repair" })], none).verdicts[0]?.kind).toBe(
			"missing",
		)
	})

	test("the bare purpose counts as a Half Life purpose", () => {
		expect(reconcileExportRows([row("r1")], [grant({ purpose: "Half Life parts" })], none).verdicts[0]?.kind).toBe(
			"landed",
		)
		expect(isHalfLifePurpose("Half Life partsX")).toBe(false)
	})

	test("fewer grants than rows is ambiguous for the whole group", () => {
		const result = reconcileExportRows([row("r1"), row("r2")], [grant()], none)
		expect(result.verdicts.map(v => v.kind)).toEqual(["ambiguous", "ambiguous"])
	})

	test("as many grants as rows lands every row, and extra grants are surplus", () => {
		const landed = reconcileExportRows([row("r1")], [grant(), grant({ id: "cdg_2" })], none)
		expect(landed.verdicts.map(v => v.kind)).toEqual(["landed"])
		expect(landed.surplus.map(g => g.id)).toEqual(["cdg_2"])
	})

	test("a grant with no readable purpose on the same amount blocks a missing verdict", () => {
		const result = reconcileExportRows([row("r1")], [grant({ email: null, id: "cdg_hidden", purpose: null })], none)
		expect(result.verdicts[0]?.kind).toBe("ambiguous")
	})

	test("a hidden owner on a different amount does not touch this group", () => {
		const result = reconcileExportRows([row("r1")], [grant({ amountCents: 9999, email: null })], none)
		expect(result.verdicts[0]?.kind).toBe("missing")
	})

	test("each maker and amount is judged on its own", () => {
		const result = reconcileExportRows([row("r1"), row("r2", { email: "second@example.com" })], [grant()], none)
		expect(result.verdicts.find(v => v.rowId === "r1")?.kind).toBe("landed")
		expect(result.verdicts.find(v => v.rowId === "r2")?.kind).toBe("missing")
	})
})
