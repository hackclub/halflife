/**
 * Where the platform lives. `/` is the landing page; a signed-in visitor who
 * lands there is sent here (see proxy.ts), so the trail has one URL of its own
 * and every "home" in the shell — the logo, the Home tab, the first-run intro —
 * means the same place.
 */
export const PLATFORM_HOME = "/dashboard"

/**
 * The journal people are pointed at to model their own on. Linked wherever a
 * journal entry is explained or written.
 */
export const EXAMPLE_JOURNAL_URL = "https://hwdocs.hackclub.dev/journaling/example-journal/"
