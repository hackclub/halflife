/**
 * Rounding for figures a person reads off a chart.
 *
 * These are the numbers that get compared to each other – hours against hours, one funnel step against the one above it – so they are rounded to a fixed precision once, in one place. They were written out inline across the admin queries, the funnel component and the analytics markers, which meant a change to the precision had to be found in three files and got applied to two of them.
 *
 * No `server-only` here: `UserFlowFunnel` renders on the client and uses `pctOf`, so this has to be importable from both sides.
 */

/** One decimal place. */
export const round1 = (n: number): number => Math.round(n * 10) / 10

/**
 * A share as a percentage to one decimal place – 0.4 of something reads as 40, not 40.00000000000001.
 *
 * `whole === 0` is 0 rather than NaN or Infinity: every caller is a ratio of two headcounts, and an empty stage is a real state rather than an error.
 */
export const pctOf = (part: number, whole: number): number => (whole === 0 ? 0 : round1((part / whole) * 100))
