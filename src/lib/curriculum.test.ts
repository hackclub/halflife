import { describe, expect, test } from "bun:test"
import { Phase } from "@/lib/enums"
import { MIN_PHOTOS, photosRequired, progressReelHours, WEEK_META } from "@/lib/curriculum"

describe("progressReelHours", () => {
	// Curriculum phases are lowercase ("design"/"build", as the trail names them), not the Prisma enum spelling.
	const design = "design" as Phase
	const build = "build" as Phase

	test("design reels start under the cheapest tier's floor, then every ten", () => {
		expect(progressReelHours(design, 1)).toBe(5)
		expect(progressReelHours(design, 2)).toBe(15)
		expect(progressReelHours(design, 3)).toBe(25)
	})

	test("build reels start halfway to the minimum, then every five", () => {
		expect(progressReelHours(build, 1)).toBe(2.5)
		expect(progressReelHours(build, 2)).toBe(5)
		expect(progressReelHours(build, 3)).toBe(10)
	})
})

describe("photosRequired", () => {
	test("two is the floor, then one an hour", () => {
		expect(photosRequired(0)).toBe(MIN_PHOTOS)
		expect(photosRequired(1)).toBe(2)
		expect(photosRequired(2.5)).toBe(3)
		expect(photosRequired(5)).toBe(5)
	})
})

describe("WEEK_META", () => {
	test("covers every theme as design and build", () => {
		const design = WEEK_META.filter(w => w.phase === "design")
		const build = WEEK_META.filter(w => w.phase === "build")
		expect(design.length).toBe(build.length)
		expect(design.length).toBeGreaterThan(0)
		expect(WEEK_META.map(w => w.id)).toEqual([...WEEK_META.map(w => w.id)].sort((a, b) => a - b))
	})
})
