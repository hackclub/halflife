import { describe, expect, test } from "bun:test"
import type { Project, Week } from "@/lib/types"
import { fmtDate, fmtDay, projectEvents, projectStats, projectWeeks } from "@/lib/projects"

function week(id: number, checkpoints: Week["checkpoints"] = []): Week {
	return { checkpoints, id } as Week
}

function project(weekId: number): Project {
	return { weekId } as Project
}

describe("projectWeeks", () => {
	const weeks = [week(1), week(6), week(2), week(7)]

	test("gathers the design week and its build week", () => {
		expect(projectWeeks(project(1), weeks).map(w => w.id)).toEqual([1, 6])
	})

	test("a warm-up project owns no curriculum week", () => {
		expect(projectWeeks(project(0), weeks)).toEqual([])
	})
})

describe("projectEvents", () => {
	const weeks = [
		week(1, [
			{ id: "j1", kind: "journal", title: "Log" } as Week["checkpoints"][number],
			{ id: "r1", kind: "reel", reelBrief: "Film it", title: "Reel" } as Week["checkpoints"][number],
		]),
	]

	const read = (id: string) =>
		id === "j1"
			? {
					done: true,
					log: [{ at: 100, body: "worked", clips: [], id: "e1", minutes: 60 }],
					minutes: 60,
				}
			: { caption: "cap", done: true, log: [], minutes: 0 }

	test("merges sessions and finished reels newest first", () => {
		const events = projectEvents(project(1), weeks, read)
		expect(events.map(e => e.id)).toEqual(["e1", "r1"])
		expect(events[1]).toMatchObject({ brief: "Film it", kind: "reel" })
	})

	test("skips unfinished reels and undated sessions sort last", () => {
		const pending = projectEvents(project(1), weeks, () => ({ done: false, log: [], minutes: 0 }))
		expect(pending).toEqual([])
	})
})

describe("projectStats", () => {
	test("totals sessions, reels, hours and the start", () => {
		// Newest first, as projectEvents returns them: the start is the last one.
		const stats = projectStats([
			{ at: 300, brief: "", caption: "", id: "r1", kind: "reel", title: "", weekId: 1 },
			{ at: 200, body: "", clips: [], id: "e2", kind: "session", minutes: 30, weekId: 1 },
			{ at: 100, body: "", clips: [], id: "e1", kind: "session", minutes: 60, weekId: 1 },
		])
		expect(stats).toEqual({ hours: 1.5, reels: 1, sessions: 2, started: 100 })
	})

	test("an empty project starts at zero", () => {
		expect(projectStats([])).toEqual({ hours: 0, reels: 0, sessions: 0, started: 0 })
	})
})

describe("fmtDate / fmtDay", () => {
	test("prints local calendar dates by hand", () => {
		expect(fmtDate(new Date(2026, 9, 5, 12).getTime())).toBe("5 Oct 2026")
		expect(fmtDate(0)).toBe("undated")
	})

	test("reads a day string as parts, never as an instant", () => {
		expect(fmtDay("2026-10-05")).toBe("5 Oct 2026")
		expect(fmtDay("not-a-day")).toBe("not-a-day")
	})
})
