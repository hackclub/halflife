/**
 * Week 5 is freestyle: no set theme and no dedicated starter project, so making a project that week opens on a page that says so before the form.
 *
 * The theme underneath is still Breadboard Computer – it is what the database, the review queue and the admin screens call it – and only what participants read is renamed. The rename switches itself on at `FREESTYLE_STARTS_AT` rather than shipping in a deploy, so nobody has to be awake at midnight to release it.
 */
export const FREESTYLE_WEEK = 5

/**
 * Midnight Eastern at the start of week 5, Monday 2 November 2026. Clocks went back on 1 November, so midnight is 05:00 UTC, and it is the same instant `weekOpensAt` gives week 5 for the 5 October start.
 */
export const FREESTYLE_STARTS_AT = new Date("2026-11-02T05:00:00.000Z")

/** What participants call week 5 once it is freestyle, in the two cases the trail and the theme list use. */
export const FREESTYLE_LABEL = "Freestyle"
export const FREESTYLE_BLURB = "Design a project of your own, then build it."

let previewing = false

/**
 * Admins only, and only in the browser: show the freestyle copy now, ahead of `FREESTYLE_STARTS_AT`. The store calls this for an admin who turned the preview on; a server process is shared between every request, so it never takes the flag.
 */
export function setFreestylePreview(on: boolean): void {
	if (typeof window === "undefined") return
	previewing = on
}

/** Whether participants see week 5 as freestyle at `at`: from midnight on its first day, or now for an admin previewing it. */
export const isFreestyle = (at: Date = new Date()): boolean => previewing || at >= FREESTYLE_STARTS_AT

export interface FreestyleGuide {
	readonly title: string
	readonly url: string
}

/** Blueprint's starter projects, offered as places to find an idea rather than as a starter to take. */
export const FREESTYLE_GUIDES: readonly FreestyleGuide[] = Object.freeze([
	Object.freeze({
		title: "Flight controller",
		url: "https://blueprint.hackclub.com/starter-projects/flightcontroller",
	}),
	Object.freeze({ title: "LoRa", url: "https://blueprint.hackclub.com/starter-projects/lora" }),
	Object.freeze({ title: "Dev board", url: "https://blueprint.hackclub.com/starter-projects/devboard" }),
	Object.freeze({ title: "Split keyboard", url: "https://blueprint.hackclub.com/starter-projects/split-keyboard" }),
])
