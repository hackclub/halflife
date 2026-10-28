import { redirect } from "next/navigation"

/**
 * A stale link to the old sign-in page.
 *
 * Signing in starts from the landing page's mark, which goes straight to Hack Club Auth and comes back to the trail, so a page of our own here asked the same question twice. It also meant the only public screen in the staff console's design language, carrying the platform's marketing metadata and indexable. The route is kept as a redirect because it has been bookmarked and pasted around; temporary rather than permanent, so it can come back if providers ever need a fallback page.
 */
export default function LegacyLoginRedirect() {
	redirect("/")
}
