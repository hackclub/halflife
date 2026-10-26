import type { Page } from "@playwright/test"

/**
 * Skip the per-device intro so a test starts on the trail rather than in the fly-through.
 *
 * The store keeps this ceremony in `localStorage` under `halflife.ceremony.v4`. The key is duplicated here on purpose: if it moves, the onboarding tests stop seeing the first checkpoint and fail visibly rather than silently depending on the intro.
 */
export async function skipIntro(page: Page): Promise<void> {
	await page.addInitScript(() => {
		try {
			window.localStorage.setItem(
				"halflife.ceremony.v4",
				JSON.stringify({ doomscrollerOpen: false, phase: "done", toured: true, version: 4 }),
			)
		} catch {
			// An opaque origin (about:blank, a sandboxed frame) has no storage; the app's own origin does.
		}
	})
}
