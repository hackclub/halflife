import { WARMUP_WEEK_ID } from "./config/program"
import { DESIGN_WEEKS } from "./config/printers"
import type { Project, SessionLog, Week } from "./types"

/**
 * A project is one theme carried across two weeks — designed in week N, built
 * in week N + 5 — so everything it accumulated lives under two week ids and
 * has to be gathered back into one story.
 */

/** What the timeline needs to read out of a checkpoint. Structural on purpose: * the store owns this shape, and this file has no business importing it. */
export interface CheckpointRead {
	done: boolean
	at?: number
	caption?: string
	minutes: number
	log: SessionLog[]
}

export type ProjectEvent =
	| {
			kind: "session"
			id: string
			at: number
			weekId: number
			minutes: number
			body: string
			clips: string[]
	  }
	| {
			kind: "reel"
			id: string
			at: number
			weekId: number
			title: string
			caption: string
			brief: string
	  }

/** The design week that owns a project, and the build week that finishes it. */
export function projectWeeks(project: Project, weeks: Week[]): Week[] {
	// A warm-up project has no curriculum week. Empty rather than "week 0 plus
	// its build week": week 0 + DESIGN_WEEKS is week 5, the breadboard design
	// week, and gathering its checkpoints would put a stranger's trail events on
	// the warm-up card.
	const ids = project.weekId === WARMUP_WEEK_ID ? [] : [project.weekId, project.weekId + DESIGN_WEEKS]
	return weeks.filter((w) => ids.includes(w.id))
}

/**
 * Everything the maker put on the record for this project, newest first.
 *
 * Sessions and reels are one stream rather than two lists: they happened in
 * one order, and splitting them would hide that a reel was posted in the
 * middle of a week's work rather than at the end of it. Ties break on the id
 * so the order is stable when two land in the same millisecond.
 */
export function projectEvents(project: Project, weeks: Week[], read: (id: string) => CheckpointRead): ProjectEvent[] {
	const out: ProjectEvent[] = []

	for (const week of projectWeeks(project, weeks)) {
		for (const cp of week.checkpoints) {
			const state = read(cp.id)

			if (cp.kind === "journal") {
				for (const entry of state.log) {
					out.push({
						kind: "session",
						id: entry.id,
						// Sessions written before entries were dated carry no time. Zero
						// rather than undefined, or the subtraction below goes NaN and
						// takes the whole ordering with it.
						at: entry.at ?? 0,
						weekId: week.id,
						minutes: entry.minutes,
						body: entry.body,
						clips: entry.clips ?? [],
					})
				}
			} else if (cp.kind === "reel" && state.done) {
				out.push({
					kind: "reel",
					id: cp.id,
					// Saves written before completions were dated have no time on them.
					// Nothing sensible orders them, so they sort to the bottom rather
					// than claiming the top with a zero.
					at: state.at ?? 0,
					weekId: week.id,
					title: cp.title,
					caption: state.caption ?? "",
					brief: cp.reelBrief ?? "",
				})
			}
		}
	}

	return out.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
}

/** The running totals a project card and its header both want. */
export function projectStats(events: ProjectEvent[]) {
	const sessions = events.filter((e) => e.kind === "session")
	const minutes = sessions.reduce((n, e) => n + (e.kind === "session" ? e.minutes : 0), 0)
	const started = events[events.length - 1]?.at ?? 0
	return {
		sessions: sessions.length,
		reels: events.length - sessions.length,
		hours: minutes / 60,
		started,
	}
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * Dates are written out by hand rather than handed to toLocaleDateString,
 * which resolves against whatever ICU data the runtime happens to carry and
 * so can disagree between the server render and the browser's.
 */
export function fmtDate(at: number): string {
	if (!at) return "undated"
	const d = new Date(at)
	return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * The same date as `fmtDate`, from a `YYYY-MM-DD` day rather than an instant.
 *
 * The day is read as parts, not handed to `new Date`, because the string is a
 * calendar day in the PROGRAM's timezone: parsed as an instant it is UTC
 * midnight, and a reader west of UTC would be shown the day before.
 */
export function fmtDay(day: string): string {
	const [year, month, date] = day.split("-").map(Number)
	if (!year || !month || !date || month < 1 || month > 12) return day
	return `${date} ${MONTHS[month - 1]} ${year}`
}

/** Hours, two decimals at most and never a trailing zero. */
export function fmtHours(h: number): string {
	return `${Math.round(h * 100) / 100}h`
}
