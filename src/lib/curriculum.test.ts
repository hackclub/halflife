import { describe, expect, test } from "bun:test"
import { checkpointsFor, MIN_PHOTOS, photosRequired, progressReelHours, WEEK_META } from "@/lib/curriculum"
import type { Phase } from "@/lib/types"

function week1(): (typeof WEEK_META)[number] {
	const [meta] = WEEK_META
	if (!meta) throw new Error("WEEK_META is empty")
	return meta
}

function week2(): (typeof WEEK_META)[number] {
	const [, meta] = WEEK_META
	if (!meta) throw new Error("WEEK_META is short")
	return meta
}

function buildWeek(): (typeof WEEK_META)[number] {
	const meta = WEEK_META.find(w => w.id === 6)
	if (!meta) throw new Error("WEEK_META is short")
	return meta
}

const trail = (
	meta: (typeof WEEK_META)[number],
	entryMinutes: number[],
	isDone: (id: string) => boolean,
	submitHours: number,
	needsProject = false,
): string[] =>
	checkpointsFor(meta, entryMinutes, isDone, submitHours, needsProject).map(
		c => `${c.id}:${c.kind}${c.branch ? `:${c.branch}` : ""}`,
	)

describe("progressReelHours", () => {
	// Curriculum phases are lowercase ("design"/"build", as the trail names them), not the Prisma enum spelling.
	const design: Phase = "design"
	const build: Phase = "build"

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

describe("checkpointsFor", () => {
	test("week one opens with setup, an optional pitch, and the first entry", () => {
		expect(trail(week1(), [], () => false, 6)).toEqual([
			"w1-onboard:onboarding",
			"w1-reel-idea:reel:idea",
			"w1-entry-1:journal:skip",
			"w1-reel-1:reel",
			"w1-submit:submit",
		])
	})

	test("week one with a deleted project gets the project node back", () => {
		expect(trail(week1(), [], () => false, 6, true)[1]).toBe("w1-project:project")
	})

	test("other design weeks open with the project form and a gated pitch", () => {
		expect(trail(week2(), [], () => false, 6)).toEqual([
			"w2-project:project",
			"w2-reel-idea:reel",
			"w2-entry-1:journal",
			"w2-reel-1:reel",
			"w2-submit:submit",
		])
	})

	test("reels land where the clock crosses their mark", () => {
		expect(trail(week2(), [60], () => false, 6)).toEqual([
			"w2-project:project",
			"w2-reel-idea:reel",
			"w2-entry-1:journal",
			"w2-entry-2:journal",
			"w2-reel-1:reel",
			"w2-submit:submit",
		])
	})

	test("build weeks skip the pitch and the project node", () => {
		expect(trail(buildWeek(), [], () => false, 5)).toEqual(["w6-entry-1:journal", "w6-reel-1:reel", "w6-submit:submit"])
	})

	test("a submitted week shows only what happened", () => {
		expect(trail(week2(), [], id => id === "w2-submit", 6)).toEqual([
			"w2-project:project",
			"w2-reel-idea:reel",
			"w2-submit:submit",
		])
	})

	test("past the floor the trail forks into keep and submit", () => {
		expect(trail(week2(), [400], () => false, 6)).toEqual([
			"w2-project:project",
			"w2-reel-idea:reel",
			"w2-entry-1:journal",
			"w2-reel-1:reel",
			"w2-entry-2:journal:keep",
			"w2-submit:submit:submit",
		])
	})

	test("later reels name what changed since the last one", () => {
		const reel2 = trail(week2(), [1200], () => false, 6).find(id => id.startsWith("w2-reel-2"))
		expect(reel2).toBe("w2-reel-2:reel")
		const cps = checkpointsFor(week2(), [1200], () => false, 6)
		expect(cps.find(c => c.id === "w2-reel-2")).toMatchObject({
			blurb: "What has changed since the last one.",
			reelBrief: "Put the last version next to this one and say what moved.",
			title: "15h progress reel",
		})
	})

	test("week one's skip arm earns its reel from the first entry's hours", () => {
		expect(trail(week1(), [300], () => false, 6)).toEqual([
			"w1-onboard:onboarding",
			"w1-reel-idea:reel:idea",
			"w1-entry-1:journal:skip",
			"w1-reel-1:reel",
			"w1-entry-2:journal",
			"w1-reel-2:reel",
			"w1-submit:submit",
		])
	})
})

describe("WEEK_META", () => {
	test("covers every theme as design and build", () => {
		const design = WEEK_META.filter(w => w.phase === "design")
		const build = WEEK_META.filter(w => w.phase === "build")
		expect(design.length).toBe(build.length)
		expect(design.length).toBeGreaterThan(0)
		expect(WEEK_META.map(w => w.id)).toEqual(WEEK_META.map(w => w.id).toSorted((a, b) => a - b))
	})
})
