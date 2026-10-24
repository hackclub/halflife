import { describe, expect, test } from "bun:test"
import { withFields } from "@/lib/rows"

describe("withFields", () => {
	test("replaces the listed fields on a new object", () => {
		const row = { createdAt: "2026-01-01 00:00:00.000", id: "a" }
		const out = withFields(row, { createdAt: new Date("2026-01-01T00:00:00.000Z") })
		expect(out).toEqual({ createdAt: new Date("2026-01-01T00:00:00.000Z"), id: "a" })
	})

	test("does not mutate the input", () => {
		const row = { id: "a", n: 1 }
		withFields(row, { n: 2 })
		expect(row).toEqual({ id: "a", n: 1 })
	})
})
