import { describe, expect, test } from "bun:test"
import { projectsByName } from "@/lib/hackatime"

describe("projectsByName", () => {
	test("keeps one entry per project name, adding the time under it", () => {
		expect(
			projectsByName([
				{ name: "Other", total_seconds: 1260 },
				{ name: "stasis", total_seconds: 3600 },
				{ name: "Other", total_seconds: 0 },
			]),
		).toEqual([
			{ name: "Other", totalSeconds: 1260 },
			{ name: "stasis", totalSeconds: 3600 },
		])
	})

	test("leaves an already-unique list in order", () => {
		expect(
			projectsByName([
				{ name: "b", total_seconds: 2 },
				{ name: "a", total_seconds: 1 },
			]),
		).toEqual([
			{ name: "b", totalSeconds: 2 },
			{ name: "a", totalSeconds: 1 },
		])
	})
})
