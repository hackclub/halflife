/**
 * Where a hand-in's review screen lives in Ire.
 *
 * A pure module with no server imports, so a link built into a notification or an admin panel can be checked without loading the database layer. The API and the web app share an origin by default; `IRE_BASE` overrides the web origin when they do not.
 */

function ireOrigin(): string {
	return (process.env.IRE_BASE ?? process.env.IRE_API_URL ?? "").trim().replace(/\/$/, "")
}

/** The review screen for one ship, or null when this deployment has no Ire host configured. */
export function ireSubmissionUrl(submissionId: string): string | null {
	const origin = ireOrigin()
	if (!origin) return null
	return `${origin}/review/${encodeURIComponent(submissionId)}`
}

/** The queue, for the admin panel and operator links. */
export function ireQueueUrl(): string | null {
	const origin = ireOrigin()
	return origin ? `${origin}/queue` : null
}
