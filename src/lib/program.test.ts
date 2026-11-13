import { describe, expect, test } from "bun:test"
import { PhaseStatus } from "@/lib/enums"
import { projectDescriptionLockReason, projectEditLockReason } from "@/lib/program"

const project = (designStatus: PhaseStatus, buildStatus: PhaseStatus) => ({ buildStatus, designStatus })

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
