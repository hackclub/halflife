import { describe, expect, test } from "bun:test"
import { projectSecondsFrom, projectsByName } from "@/lib/hackatime"

describe("projectSecondsFrom", () => {
	test("adds every entry Hackatime lists under one name", () => {
		const body = {
			data: {
				projects: [
					{ name: "Other", total_seconds: 1260 },
					{ name: "stasis", total_seconds: 3600 },
					{ name: "Other", total_seconds: 540 },
				],
			},
		}
		expect(projectSecondsFrom(body, "Other")).toEqual({ seconds: 1800, stale: false })
	})

	test("a name missing from the list is not a fresh zero", () => {
		const body = { data: { projects: [{ name: "stasis", total_seconds: 3600 }] } }
		expect(projectSecondsFrom(body, "Other")).toMatchObject({ notFound: true, seconds: 0, stale: true })
	})
})

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
