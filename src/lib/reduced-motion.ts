/**
 * Whether the reader has asked the system for less movement.
 *
 * Every animation in the reels respects this, and three of them had their own copy of the check. Read at the moment of use rather than cached in state: the setting can be flipped while the page is open, and a reel scrolled into view afterwards should honour it without a reload.
 *
 * Server-rendering safe. Returns false where there is no window, which is what a render has to assume – matching markup rather than assuming no animation and shipping markup that does not match.
 */
export function prefersStill(): boolean {
	if (typeof window === "undefined") return false
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
