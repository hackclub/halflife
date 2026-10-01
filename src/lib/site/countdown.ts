/**
 * The arithmetic behind the landing page's week-1 countdown.
 *
 * Kept out of the component so the one thing that can actually be wrong — how a
 * span of milliseconds splits into days, hours, minutes and seconds — is a pure
 * function the contract tests can drive. The component is then only the clock
 * and the markup.
 */

/** The units the countdown shows, largest first. */
export const COUNTDOWN_UNITS = [
	{ key: "days", label: "days", ms: 24 * 60 * 60 * 1000 },
	{ key: "hours", label: "hours", ms: 60 * 60 * 1000 },
	{ key: "minutes", label: "minutes", ms: 60 * 1000 },
	{ key: "seconds", label: "seconds", ms: 1000 },
] as const

export type CountdownParts = Record<(typeof COUNTDOWN_UNITS)[number]["key"], number>

/**
 * Split a span of milliseconds into whole days/hours/minutes/seconds.
 *
 * The remainder is carried down each unit rather than recomputed from the
 * total, so 90 minutes reads as 1 hour 30 minutes and not 1 hour 90 minutes.
 * A negative or non-finite span clamps to zero: the countdown is only ever
 * asked to show the time until a moment, and a moment already past is behind
 * it, not a negative count.
 */
export function countdownParts(ms: number): CountdownParts {
	let rest = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0
	const out: CountdownParts = { days: 0, hours: 0, minutes: 0, seconds: 0 }
	for (const unit of COUNTDOWN_UNITS) {
		out[unit.key] = Math.floor(rest / unit.ms)
		rest -= out[unit.key] * unit.ms
	}
	return out
}

/** Two digits, for every unit but days. */
export function pad2(n: number): string {
	return n.toString().padStart(2, "0")
}
