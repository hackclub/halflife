/**
 * Where the platform lives. `/` is the landing page; a signed-in visitor who lands there is sent here (see proxy.ts), so the trail has one URL of its own and every "home" in the shell – the logo, the Home tab, the first-run intro – means the same place.
 */
export const PLATFORM_HOME = "/dashboard"

/**
 * The journal people are pointed at to model their own on. Linked wherever a journal entry is explained or written.
 */
export const EXAMPLE_JOURNAL_URL = "https://hwdocs.hackclub.dev/journaling/example-journal/"

/**
 * Hack Club's walk-through of what a project README has to contain, from Hack Club's shipping docs. Linked wherever a README is asked for: the docs' own README page, the repo checks that block on one, and the repo field itself, so the answer to "what goes in it?" is one click from wherever the question comes up.
 */
export const README_GUIDE_URL = "https://hwdocs.hackclub.dev/shipping/101/#4-write-a-readmemd-about-your-project"
