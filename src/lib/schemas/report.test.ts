import { describe, expect, test } from "bun:test"
import { ReportReason, ReportTarget } from "@/lib/enums"
import { createReportSchema } from "@/lib/schemas/report"

describe("createReportSchema", () => {
	test("accepts a flagged row with optional context", () => {
		expect(
			createReportSchema.safeParse({ reason: ReportReason.OTHER, target: ReportTarget.PROJECT, targetId: "abc" })
				.success,
		).toBe(true)
		expect(
			createReportSchema.safeParse({
				details: "context",
				reason: ReportReason.MISCONDUCT,
				target: ReportTarget.DEVLOG,
				targetId: "abc",
			}).success,
		).toBe(true)
	})

	test("rejects unknown reasons, targets and stray fields", () => {
		expect(
			createReportSchema.safeParse({ reason: "nope", target: ReportTarget.PROJECT, targetId: "abc" }).success,
		).toBe(false)
		expect(createReportSchema.safeParse({ reason: ReportReason.OTHER, target: ReportTarget.PROJECT }).success).toBe(
			false,
		)
		expect(
			createReportSchema.safeParse({
				extra: 1,
				reason: ReportReason.OTHER,
				target: ReportTarget.PROJECT,
				targetId: "abc",
			}).success,
		).toBe(false)
	})
})
