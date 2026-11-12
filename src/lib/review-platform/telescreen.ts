import "server-only"

/**
 * The link to a maker's Telescreen subject page, Hack Club's review cockpit – the button Fabricate's review top bar has.
 *
 * The screen links to `/api/reviews/[id]/telescreen`, which builds the URL and redirects. The review page shows the maker's Slack id to every reviewer, but the queue does not carry it, so nobody can read every maker's Slack id out of the queue.
 */
export const subjectUrl = (slackId: string): string =>
	`https://telescreen.hackclub.com/subjects/${encodeURIComponent(slackId)}`
