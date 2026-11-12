/**
 * The confirmed HCB totals for topped-up starter cards, checked before anything is recorded.
 *
 * After an admin tops up a card by hand in HCB, they confirm the card's new total in a file of `email,project_id,hcb_total_usd`. These checks decide whether that total can be recorded. Pure, so the rules are tested without a database.
 */

export interface ConfirmedTotal {
	email: string
	projectId: string
	totalCents: number
}

export interface ConfirmTarget {
	email: string
	/** What Airtable's `Funding given` already records, in cents. */
	fundingGivenCents: number
	/** The live card total already recorded on the site, in cents. Null when none is recorded. */
	recordedCents: number | null
	/** What the card should total once topped up, in cents: the parts + PCB target. */
	targetCents: number
}

const HEADER = "email,project_id,hcb_total_usd"

/** Parses the confirmed-totals file. Anything malformed is reported, never guessed at. */
export function parseConfirmedTotals(csv: string): { problems: string[]; rows: ConfirmedTotal[] } {
	const problems: string[] = []
	const rows: ConfirmedTotal[] = []
	const lines = csv
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0)
	if (lines[0] !== HEADER) return { problems: [`the first line must be exactly "${HEADER}"`], rows }

	for (const [index, line] of lines.slice(1).entries()) {
		const at = `line ${index + 2}`
		const parts = line.split(",").map(part => part.trim())
		const [email = "", projectId = "", amount = ""] = parts
		if (parts.length !== 3 || !email.includes("@") || projectId === "") {
			problems.push(`${at}: expected email,project_id,hcb_total_usd`)
			continue
		}
		if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
			problems.push(`${at}: "${amount}" is not a dollar amount`)
			continue
		}
		rows.push({ email: email.toLowerCase(), projectId, totalCents: Math.round(Number(amount) * 100) })
	}
	return { problems, rows }
}

/**
 * Why a confirmed total must not be recorded, or null when it can be.
 *
 * A card never goes down on the site, never goes above the target, and never falls below what `Funding given` already records. Each check refuses rather than guesses.
 */
export function refusedTotal(row: ConfirmedTotal, target: ConfirmTarget): string | null {
	if (row.email !== target.email.toLowerCase()) return "the email does not match the project's owner"
	if (row.totalCents > target.targetCents) return "above the parts + PCB target"
	if (target.recordedCents !== null && row.totalCents < target.recordedCents)
		return "below the card already recorded on the site"
	if (row.totalCents < target.fundingGivenCents) return "below what Funding given already records"
	return null
}
