import { describe, expect, test } from "bun:test"
import { PhaseStatus } from "@/lib/enums"
import {
	changedProjectKeys,
	journalWindow,
	projectDescriptionLockReason,
	projectEditLockReason,
	workedDayFor,
} from "@/lib/program"

const project = (designStatus: PhaseStatus, buildStatus: PhaseStatus) => ({ buildStatus, designStatus })

/** Week 1 is 7–13 September 2026, in UTC. */
const settings = { eventStartDate: new Date("2026-09-07T00:00:00.000Z"), programTimezone: "UTC" }

describe("journalWindow", () => {
	test("runs from the start of the current program week to today", () => {
		expect(journalWindow(settings, new Date("2026-09-10T12:00:00.000Z"))).toEqual({
			earliest: "2026-09-07",
			today: "2026-09-10",
		})
		expect(journalWindow(settings, new Date("2026-09-14T00:30:00.000Z"))).toEqual({
			earliest: "2026-09-14",
			today: "2026-09-14",
		})
	})

	test("allows only today before the program opens", () => {
		expect(journalWindow(settings, new Date("2026-09-02T12:00:00.000Z"))).toEqual({
			earliest: "2026-09-02",
			today: "2026-09-02",
		})
	})
})

describe("workedDayFor", () => {
	const now = new Date("2026-09-10T12:00:00.000Z")

	test("is today when no day is given", () => {
		expect(workedDayFor(settings, undefined, now)).toBe("2026-09-10")
	})

	test("accepts a day earlier in the current program week", () => {
		expect(workedDayFor(settings, "2026-09-07", now)).toBe("2026-09-07")
		expect(workedDayFor(settings, "2026-09-10", now)).toBe("2026-09-10")
	})

	test("refuses a day after today", () => {
		expect(() => workedDayFor(settings, "2026-09-11", now)).toThrow("can't be dated after today")
	})

	test("refuses a day in an earlier program week", () => {
		expect(() => workedDayFor(settings, "2026-09-06", now)).toThrow("started on 2026-09-07")
	})
})

describe("changedProjectKeys", () => {
	test("leaves out a tier the project already has", () => {
		expect(changedProjectKeys({ requestedTier: 2 }, { description: "x", requestedTier: 2 })).toEqual(["description"])
		expect(changedProjectKeys({ requestedTier: 2 }, { requestedTier: 2 })).toEqual([])
	})

	test("keeps a tier that differs", () => {
		expect(changedProjectKeys({ requestedTier: 2 }, { requestedTier: 3 })).toEqual(["requestedTier"])
		expect(changedProjectKeys({ requestedTier: null }, { requestedTier: 1 })).toEqual(["requestedTier"])
	})

	test("keeps every other field", () => {
		expect(changedProjectKeys({ requestedTier: 1 }, { description: "x", title: "y" })).toEqual(["description", "title"])
	})
})

describe("projectEditLockReason", () => {
	test("freezes the details once either phase is decided", () => {
		expect(projectEditLockReason(project(PhaseStatus.approved, PhaseStatus.draft))).toBe(
			"A phase of this project has been decided, so its details are final",
		)
		expect(projectEditLockReason(project(PhaseStatus.draft, PhaseStatus.rejected))).toBe(
			"A phase of this project has been decided, so its details are final",
		)
	})

	test("says unsubmit while either phase is in review", () => {
		expect(projectEditLockReason(project(PhaseStatus.in_review, PhaseStatus.draft))).toBe(
			"In review, so it can't be edited. Unsubmit to change it",
		)
		expect(projectEditLockReason(project(PhaseStatus.approved, PhaseStatus.in_review))).toBe(
			"In review, so it can't be edited. Unsubmit to change it",
		)
	})

	test("leaves an undecided project editable", () => {
		expect(projectEditLockReason(project(PhaseStatus.draft, PhaseStatus.draft))).toBeNull()
		expect(projectEditLockReason(project(PhaseStatus.update_requested, PhaseStatus.update_requested))).toBeNull()
	})
})

describe("projectDescriptionLockReason", () => {
	test("keeps the description editable for a build after the design is decided", () => {
		expect(projectDescriptionLockReason(project(PhaseStatus.approved, PhaseStatus.draft))).toBeNull()
		expect(projectDescriptionLockReason(project(PhaseStatus.rejected, PhaseStatus.draft))).toBeNull()
		expect(projectDescriptionLockReason(project(PhaseStatus.approved, PhaseStatus.update_requested))).toBeNull()
	})

	test("freezes it while either phase is in review", () => {
		expect(projectDescriptionLockReason(project(PhaseStatus.in_review, PhaseStatus.draft))).toBe(
			"In review, so it can't be edited. Unsubmit to change it",
		)
		expect(projectDescriptionLockReason(project(PhaseStatus.approved, PhaseStatus.in_review))).toBe(
			"In review, so it can't be edited. Unsubmit to change it",
		)
	})

	test("freezes it once the build is decided", () => {
		expect(projectDescriptionLockReason(project(PhaseStatus.approved, PhaseStatus.approved))).toBe(
			"The build has been decided, so its description is final",
		)
		expect(projectDescriptionLockReason(project(PhaseStatus.approved, PhaseStatus.rejected))).toBe(
			"The build has been decided, so its description is final",
		)
	})
})
