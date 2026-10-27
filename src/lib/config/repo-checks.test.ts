import { describe, expect, test } from "bun:test"
import { firmwareWaiverCovers } from "@/lib/config/repo-checks"
import { Theme } from "@/lib/enums"

const firmware = { key: "firmware" }
const readme = { key: "readme" }

describe("firmwareWaiverCovers", () => {
	test("clears a Displays hand-in whose only missing file is firmware", () => {
		expect(firmwareWaiverCovers(Theme.DISPLAYS, [firmware], true)).toBe(true)
	})

	test("needs the maker's confirmation", () => {
		expect(firmwareWaiverCovers(Theme.DISPLAYS, [firmware], false)).toBe(false)
	})

	test("does not clear another missing file alongside firmware", () => {
		expect(firmwareWaiverCovers(Theme.DISPLAYS, [firmware, readme], true)).toBe(false)
	})

	test("does not waive a file other than firmware", () => {
		expect(firmwareWaiverCovers(Theme.DISPLAYS, [readme], true)).toBe(false)
	})

	test("does not clear a theme that does not require firmware", () => {
		expect(firmwareWaiverCovers(Theme.PCB, [firmware], true)).toBe(false)
		expect(firmwareWaiverCovers(Theme.DISPLAYS, [], true)).toBe(false)
	})
})
