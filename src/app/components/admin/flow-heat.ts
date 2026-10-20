import type { CSSProperties } from "react"

/**
 * The heat ramp both funnels colour their stages with: accent where nothing was lost, danger where everything was.
 *
 * Mixed in oklch so the middle stays vivid rather than washing out through grey the way an srgb blend does. One property, `backgroundColor`, so there is no fallback to be written in an order React could undo; a browser with no color-mix leaves the band unfilled, where the headcount pill and the captions still read the stage – the same stance `flowHeatInk` takes with the text and `flowHeatWeight` with the type.
 *
 * `lossPct` is a share of the stage before, clamped to 0-100: a later week that grew is not a negative loss, it is simply a stage that did not lose anything, and reads as accent.
 */

const weightOf = (lossPct: number): number => Math.min(100, Math.max(0, lossPct))

/** A stage's background fill. */
export const flowHeat = (lossPct: number): CSSProperties => ({
	backgroundColor: `color-mix(in oklch, var(--color-danger) ${weightOf(lossPct)}%, var(--color-accent))`,
})

/** The same heat for text: muted where nothing was lost, danger-ink where everything was. An unsupported color-mix just inherits body text, which still reads. */
export const flowHeatInk = (lossPct: number): CSSProperties => ({
	color: `color-mix(in oklch, var(--color-danger-ink) ${weightOf(lossPct)}%, var(--color-ink-muted))`,
})

/** 400 where nothing was lost, 800 where everything was. */
export const flowHeatWeight = (lossPct: number): number => 400 + Math.round(weightOf(lossPct) / 25) * 100
