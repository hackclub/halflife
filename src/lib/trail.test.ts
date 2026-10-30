import { describe, expect, test } from "bun:test"
import { COINS_PER_HOUR } from "@/lib/config/printers"
import { WARMUP_WEEK_ID } from "@/lib/config/program"
import { PhaseStatus } from "@/lib/enums"
import type { StoreSnapshot } from "@/lib/queries/store"
import { deriveTrail, EMPTY } from "@/lib/trail"
import type { Project } from "@/lib/types"

const NOW = Date.UTC(2026, 0, 5, 12)

function snapshot(over: Partial<StoreSnapshot> = {}): StoreSnapshot {
	return {
		bankedCoins: 0,
		coins: 0,
		experience: null,
		goalId: "ender-3-v3-se",
		now: NOW,
		offBookHours: {},
		onboardingDone: false,
		overlapUncheckedWeeks: [],
		owedReels: [],
		participantGoal: null,
		phaseStatusByWeek: {},
		programTimezone: "UTC",
		progress: {},
		projectIdByWeek: {},
		projects: [],
		streak: 0,
		viewer: { id: "u1", image: null, isAdmin: false, name: "Maker" },
		warmups: {},
		warmupsCloseAt: NOW + 1_000_000,
		weekClosesAt: {},
		weekExtensions: {},
		weekOpensAt: {},
		...over,
	}
}

const doneEntry = (minutes: number) => ({ ...EMPTY, done: true, minutes })

describe("deriveTrail", () => {
	test("reads the clock for opening and closing a week", () => {
		const trail = deriveTrail(snapshot({ weekClosesAt: { 1: NOW + 1 }, weekOpensAt: { 1: NOW - 1 } }), NOW)
		expect(trail.weekStarted(1)).toBe(true)
		expect(trail.weekPassed(1)).toBe(false)
		expect(deriveTrail(snapshot({ weekClosesAt: { 1: NOW } }), NOW).weekPassed(1)).toBe(true)
	})

	test("sums journal minutes and tracked time into a week's hours", () => {
		const trail = deriveTrail(snapshot({ offBookHours: { 1: 1 }, progress: { "w1-entry-1": doneEntry(60) } }), NOW)
		expect(trail.weekHours(1)).toBe(2)
		expect(trail.hoursOf(trail.weekOf(1))).toBe(2)
	})

	test("unlocks the next entry only once the one before it is done", () => {
		const trail = deriveTrail(snapshot({ weekOpensAt: { 2: NOW - 1 } }), NOW)
		expect(trail.isUnlocked("w2-project")).toBe(true)
		expect(trail.isUnlocked("w2-entry-1")).toBe(false)
		expect(trail.lockReason("w2-entry-1")).toContain("New project")

		const after = deriveTrail(
			snapshot({
				progress: { "w2-project": doneEntry(0), "w2-reel-idea": doneEntry(0) },
				weekOpensAt: { 2: NOW - 1 },
			}),
			NOW,
		)
		expect(after.isUnlocked("w2-entry-1")).toBe(true)
	})

	test("projects the coins of unreviewed weeks, skipping decided ones", () => {
		const trail = deriveTrail(
			snapshot({
				offBookHours: { 1: 10 },
				phaseStatusByWeek: { 2: "approved", 3: "rejected" },
				weekOpensAt: { 1: NOW - 1 },
			}),
			NOW,
		)
		const earnFrom = trail.weeks[0]?.earnFrom ?? 0
		expect(trail.pendingCoins(1)).toBe(Math.max(0, 10 - earnFrom) * COINS_PER_HOUR)
		expect(trail.pendingCoins(3)).toBe(Math.max(0, 10 - earnFrom) * COINS_PER_HOUR)
	})

	test("finds a warm-up by project and addresses its checkpoints by id", () => {
		const project: Project = {
			buildStatus: PhaseStatus.draft,
			coverImageKey: null,
			description: "A synth.",
			designStatus: PhaseStatus.draft,
			githubRepo: null,
			id: "warm1",
			name: "Synth",
			starter: false,
			starterProjectId: null,
			tier: 1,
			weekId: WARMUP_WEEK_ID,
		}
		const trail = deriveTrail(
			snapshot({
				projects: [project],
				warmups: { warm1: { closesAt: NOW + 1000, offBookHours: 2, phase: "design" } },
			}),
			NOW,
		)
		const week = trail.warmupWeekOf("warm1")
		if (!week) throw new Error("the warm-up has no week")
		expect(week.id).toBe(WARMUP_WEEK_ID)
		expect(week.checkpoints.at(-1)?.id).toBe("wu-warm1-submit")
		expect(trail.hoursOf(week)).toBe(2)
		expect(trail.passedOf(week)).toBe(false)
	})
})
