import { describe, expect, test } from "bun:test"
import { ariExternalId, parseAriExternalId } from "@/lib/ari-id"
import { Phase } from "@/lib/enums"

describe("ariExternalId / parseAriExternalId", () => {
	test("round-trips both phases", () => {
		expect(parseAriExternalId(ariExternalId("proj_123", Phase.DESIGN))).toEqual({
			phase: Phase.DESIGN,
			themeProjectId: "proj_123",
		})
		expect(parseAriExternalId(ariExternalId("proj_123", Phase.BUILD))).toEqual({
			phase: Phase.BUILD,
			themeProjectId: "proj_123",
		})
	})

	test("splits on the last colon, so ids may contain one", () => {
		expect(parseAriExternalId("a:b:design")).toEqual({ phase: Phase.DESIGN, themeProjectId: "a:b" })
	})

	test("rejects anything else", () => {
		expect(parseAriExternalId("")).toBeNull()
		expect(parseAriExternalId("nocolon")).toBeNull()
		expect(parseAriExternalId(":design")).toBeNull()
		expect(parseAriExternalId("id:weird")).toBeNull()
		expect(parseAriExternalId("id:DESIGN")).toBeNull()
	})
})
