/**
 * Where a hand-in's review screen lives in the new Review platform.
 *
 * A pure module with no server imports, so a link built into a notification or an admin panel can be checked without loading the database layer. The API and the web app share an origin by default; `REVIEW_BASE` overrides the web origin when they do not.
 */

function reviewOrigin(): string {
	return (process.env.REVIEW_BASE ?? process.env.REVIEW_API_URL ?? "").trim().replace(/\/$/, "")
}

/** The review screen for one ship, or null when this deployment has no Review host configured. */
export function reviewSubmissionUrl(submissionId: string): string | null {
	const origin = reviewOrigin()
	if (!origin) return null
	return `${origin}/review/${encodeURIComponent(submissionId)}`
}

/** The queue, for the admin panel and operator links. */
export function reviewQueueUrl(): string | null {
	const origin = reviewOrigin()
	return origin ? `${origin}/queue` : null
}
