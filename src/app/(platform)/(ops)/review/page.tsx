import { redirect } from "next/navigation"

/** The queue moved to /reviews. Old links and bookmarks land there. */
export default function ReviewQueueRedirect() {
	redirect("/reviews")
}
