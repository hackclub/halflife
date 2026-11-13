import { describe, expect, test } from "bun:test"
import { HoursSource, MediaType, Phase } from "@/lib/enums"
import {
	MAX_SESSION_CONTENT,
	MAX_SESSION_HOURS,
	MAX_SESSION_TIMELAPSES,
	sessionCreateSchema,
	sessionUpdateSchema,
} from "@/lib/schemas/session"

const validEntry = {
	hoursClaimed: 2,
	phase: Phase.DESIGN,
	title: "Evening build",
}

describe("sessionCreateSchema", () => {
	test("accepts a minimal entry with journal defaults", () => {
		const parsed = sessionCreateSchema.safeParse(validEntry)
		expect(parsed.success).toBe(true)
		if (parsed.success)
			expect(parsed.data).toMatchObject({ hoursSource: HoursSource.MANUAL, media: [], timelapses: [] })
	})

	test("enforces the hours, content and timelapse caps", () => {
		expect(sessionCreateSchema.safeParse({ ...validEntry, hoursClaimed: MAX_SESSION_HOURS + 1 }).success).toBe(false)
		expect(sessionCreateSchema.safeParse({ ...validEntry, content: "x".repeat(MAX_SESSION_CONTENT + 1) }).success).toBe(
			false,
		)
		const timelapses = Array.from({ length: MAX_SESSION_TIMELAPSES + 1 }, (_, i) => ({ lapseId: `l${i}` }))
		expect(sessionCreateSchema.safeParse({ ...validEntry, timelapses }).success).toBe(false)
		expect(
			sessionCreateSchema.safeParse({
				...validEntry,
				media: [{ objectKey: "k", type: MediaType.IMAGE }],
			}).success,
		).toBe(true)
	})

	test("rejects bad media and stray fields", () => {
		expect(sessionCreateSchema.safeParse({ ...validEntry, media: [{ objectKey: "", type: "nope" }] }).success).toBe(
			false,
		)
		expect(sessionCreateSchema.safeParse({ ...validEntry, extra: 1 }).success).toBe(false)
	})
})

describe("workedOn", () => {
	test("is optional, and takes a real calendar day", () => {
		expect(sessionCreateSchema.safeParse({ ...validEntry, workedOn: "2026-09-08" }).success).toBe(true)
		expect(sessionCreateSchema.safeParse(validEntry).success).toBe(true)
	})

	test("refuses anything that is not a real day", () => {
		for (const workedOn of ["2026-02-30", "2026-9-8", "08/09/2026", "2026-09-08T10:00", "tomorrow"])
			expect(sessionCreateSchema.safeParse({ ...validEntry, workedOn }).success).toBe(false)
	})

	test("can be edited, and is not held to the create-only fields", () => {
		expect(sessionUpdateSchema.safeParse({ workedOn: "2026-09-08" }).success).toBe(true)
		expect(sessionUpdateSchema.safeParse({ workedOn: "2026-02-30" }).success).toBe(false)
	})
})

describe("sessionUpdateSchema", () => {
	test("edits a subset, never the images", () => {
		expect(sessionUpdateSchema.safeParse({ title: "New title" }).success).toBe(true)
		expect(sessionUpdateSchema.safeParse({ hoursClaimed: 99 }).success).toBe(false)
		expect(sessionUpdateSchema.safeParse({ media: [] }).success).toBe(false)
	})
})
