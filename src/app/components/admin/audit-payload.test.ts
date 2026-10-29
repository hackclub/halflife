import { describe, expect, test } from "bun:test"
import { auditPayload, formatAuditCompact, formatAuditValue } from "@/app/components/admin/audit-payload"

describe("auditPayload", () => {
	test("one row per field that actually changed", () => {
		const payload = auditPayload({
			after: { approvedHours: 9, status: "approved", tier: 1 },
			before: { approvedHours: null, status: "in_review", tier: 1 },
		})
		expect(payload.changes).toEqual([
			{ after: 9, before: null, field: "approvedHours" },
			{ after: "approved", before: "in_review", field: "status" },
		])
	})

	test("a removed field has no after value", () => {
		const payload = auditPayload({ after: { title: "asdf" }, before: { starterProjectId: "abc", title: "asdf" } })
		expect(payload.changes).toEqual([{ after: undefined, before: "abc", field: "starterProjectId" }])
	})

	test("a one-sided object is read as fields added or removed", () => {
		const payload = auditPayload({ after: { hideContent: true, reason: "guard test" } })
		expect(payload.changes).toEqual([
			{ after: true, before: undefined, field: "hideContent" },
			{ after: "guard test", before: undefined, field: "reason" },
		])
	})

	test("a scalar before and after becomes one value row", () => {
		expect(auditPayload({ after: false, before: true }).changes).toEqual([
			{ after: false, before: true, field: "value" },
		])
	})

	test("unchanged values are dropped", () => {
		expect(auditPayload({ after: { tier: 1 }, before: { tier: 1 } }).changes).toEqual([])
		expect(auditPayload({ after: true, before: true }).changes).toEqual([])
	})

	test("the rest of the payload is recorded detail, in order", () => {
		const payload = auditPayload({
			after: { status: "REJECTED" },
			before: { status: "PENDING" },
			phase: "DESIGN",
			reason: "Refunding a test order",
			refunded: 15,
		})
		expect(payload.fields).toEqual([
			{ key: "phase", value: "DESIGN" },
			{ key: "reason", value: "Refunding a test order" },
			{ key: "refunded", value: 15 },
		])
	})

	test("missing metadata is empty, not an error", () => {
		expect(auditPayload(null)).toEqual({ changes: [], fields: [] })
		expect(auditPayload(undefined)).toEqual({ changes: [], fields: [] })
	})

	test("a non-object payload is kept as one value", () => {
		expect(auditPayload(["a", "b"])).toEqual({ changes: [], fields: [{ key: "payload", value: ["a", "b"] }] })
	})
})

describe("audit value formatting", () => {
	test("absent and null stay distinct", () => {
		expect(formatAuditValue(undefined)).toBe("–")
		expect(formatAuditValue(null)).toBe("null")
	})

	test("objects are indented for the expanded view", () => {
		expect(formatAuditValue({ banked: 0, total: 15 })).toBe('{\n  "banked": 0,\n  "total": 15\n}')
	})

	test("the summary keeps a value on one line and short enough for the cell", () => {
		expect(formatAuditCompact({ banked: 0, total: 15 })).toBe('{"banked":0,"total":15}')
		expect(formatAuditCompact("line one\nline two")).toBe("line one line two")
		const long = formatAuditCompact("a".repeat(80))
		expect(long.length).toBe(60)
		expect(long.endsWith("…")).toBe(true)
	})
})
