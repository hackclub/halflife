/**
 * The programme's Net Promoter Score, from the answers the dashboard prompt collects.
 *
 * The score is the standard one: promoters (9-10) minus detractors (0-6) as a share of everyone who answered, so it runs from -100 to 100. Passives (7-8) count towards the total but not either side of it.
 *
 * Kept apart from the Airtable read that gathers the answers so the arithmetic can be tested without a base: the storage side is in `lib/airtable/nps`.
 */
export interface NpsSummary {
	/** Answers scoring 0-6. */
	detractors: number
	/** Answers scoring 7-8. */
	passives: number
	/** Answers scoring 9-10. */
	promoters: number
	/** Every valid score counted, which is the denominator of the score. */
	responses: number
	/** Promoter share minus detractor share, rounded to a whole point. Null when nobody has answered. */
	score: number | null
}

/**
 * Summarise a set of scores.
 *
 * Only integers from 0 to 10 are counted. The form already enforces that, but a score edited by hand in Airtable should not be able to pull the programme's number somewhere the scale cannot go – an unreadable value is left out rather than guessed at.
 */
export function summariseNps(scores: Iterable<number>): NpsSummary {
	let detractors = 0
	let passives = 0
	let promoters = 0

	for (const score of scores) {
		if (!Number.isInteger(score) || score < 0 || score > 10) continue
		if (score <= 6) detractors++
		else if (score <= 8) passives++
		else promoters++
	}

	const responses = detractors + passives + promoters
	return {
		detractors,
		passives,
		promoters,
		responses,
		score: responses === 0 ? null : Math.round(((promoters - detractors) / responses) * 100),
	}
}
