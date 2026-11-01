import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { WEEK_META } from "@/lib/curriculum"
import { Theme } from "@/lib/enums"
import { FREESTYLE_STARTS_AT, isFreestyle } from "./freestyle"
import { getThemeDef, participantThemeLabel } from "./program"

const before = new Date(FREESTYLE_STARTS_AT.getTime() - 1)

afterEach(() => {
	setSystemTime()
})

describe("isFreestyle", () => {
	test("switches on at midnight Eastern on week 5's first day", () => {
		expect(FREESTYLE_STARTS_AT.toISOString()).toBe("2026-11-02T05:00:00.000Z")
		expect(isFreestyle(before)).toBe(false)
		expect(isFreestyle(FREESTYLE_STARTS_AT)).toBe(true)
	})
})

describe("participant copy", () => {
	test("reads Breadboard Computer until midnight", () => {
		setSystemTime(before)
		expect(participantThemeLabel(Theme.BREADBOARD_COMPUTER)).toBe("Breadboard Computer")
		expect(WEEK_META[4]?.fullName).toBe("Breadboard Computer Week")
	})

	test("reads Freestyle from midnight, in the design week and its build week", () => {
		setSystemTime(FREESTYLE_STARTS_AT)
		expect(participantThemeLabel(Theme.BREADBOARD_COMPUTER)).toBe("Freestyle")
		expect(WEEK_META[4]?.fullName).toBe("Freestyle Week")
		expect(WEEK_META[4]?.theme).toBe("Freestyle")
		expect(WEEK_META[9]?.fullName).toBe("Freestyle Week (Build)")
		expect(WEEK_META[9]?.summary).toBe("Assemble the freestyle project you designed in week 5.")
	})

	test("leaves the admin label and every other theme alone", () => {
		setSystemTime(FREESTYLE_STARTS_AT)
		expect(getThemeDef(Theme.BREADBOARD_COMPUTER).label).toBe("Breadboard Computer")
		expect(participantThemeLabel(Theme.DISPLAYS)).toBe("Displays")
		expect(WEEK_META[3]?.fullName).toBe("Displays Week")
	})
})
