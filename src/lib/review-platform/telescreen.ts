import "server-only"

/**
 * The link to a maker's Telescreen subject page, Hack Club's review cockpit – the button Fabricate's review top bar has.
 *
 * The page never carries the Slack id it needs: Half Life keeps that from the reviewer role, so the screen links to `/api/reviews/[id]/telescreen` and that route builds the URL and redirects. A reviewer who opens it sees where it goes, as on any link; what they cannot do is read every maker's Slack id out of the queue.
 */
export const subjectUrl = (slackId: string): string =>
	`https://telescreen.hackclub.com/subjects/${encodeURIComponent(slackId)}`
