/**
 * Where a hand-in's review screen lives on Ari.
 *
 * The path is `/p/<program>/review/<ship>`, where the program is Half Life's own Ari program id and the ship is the id Ari returned when the hand-in was sent (`PhaseSubmission.ariSubmissionId`). The resend tool reads the same links back out of Ari's Reviewed list, so the two shapes cannot drift unnoticed.
 *
 * A pure module with no server imports, so a link built into a notification can be checked without loading the database layer.
 */

/** Ari's web app. `ARI_BASE_URL` is a different host – the API the SDK signs against – so the web origin is its own value, defaulting to the one Ari has. */
function ariWebOrigin(): string {
	return (process.env.ARI_BASE ?? "https://ari.hackclub.com").replace(/\/$/, "")
}

/**
 * The review screen for one ship, or null when this deployment has no Ari program configured.
 *
 * Null rather than a broken link: a deployment not onboarded to Ari has no ship ids and no program to put in the path, so the caller should print no link rather than one that 404s.
 */
export function ariReviewUrl(submissionId: string): string | null {
	const programId = process.env.ARI_PROGRAM_ID
	if (!programId) return null
	return `${ariWebOrigin()}/p/${programId}/review/${submissionId}`
}
