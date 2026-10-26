import { expect, type Locator } from "@playwright/test"

/** React copies the props it hydrated a DOM node with into a `__reactProps$…` own property. Without one, the node is still the server's HTML. */
const REACT_PROPS_PREFIX = "__reactProps$"

/**
 * Wait until React has hydrated an element before driving it.
 *
 * Playwright's actionability checks prove an element is visible, stable and enabled, but they say nothing about whether React has attached its event handlers. The dev server compiles a page's client components after serving the HTML, so a submit button can be clicked while its form is still plain HTML: the browser performs the form's default submission – a GET of the same URL – and the component's state, validation and "Saved." message never run. A controlled input has the same problem in reverse: a change made before hydration is overwritten when React attaches.
 *
 * The marker React sets on every node it hydrates is the only signal the page gives, so the test waits on it rather than on a timeout long enough to "usually" work.
 */
export async function waitForHydration(locator: Locator): Promise<void> {
	await expect
		.poll(
			() =>
				locator.evaluate((node, prefix) => Object.keys(node).some(key => key.startsWith(prefix)), REACT_PROPS_PREFIX),
			// A cold `next dev` compiles the page's client bundle on the first request, which can take longer than the suite's default expect timeout. CI runs a built server, so this only ever waits that long on a laptop.
			{ message: "React has not hydrated this element yet", timeout: 30_000 },
		)
		.toBe(true)
}
