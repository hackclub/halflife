import { GRANT_CARD_CSV_HEADER, quoteField } from "@/lib/grant-card-csv"
import { GRANT_CARD_INVITE_MESSAGE, grantCardInstructions, grantCardPurpose } from "@/lib/grant-card-policy"

/**
 * The HCB import file for new starter cards, kept pure so it can be pinned by tests.
 *
 * Only makers with no live card are in it. A maker who already holds a card is topped up by hand in HCB, not imported here. The HCB import reads the header by name and a renamed or re-quoted column fails the whole upload, so the rows go through the same `quoteField` as every other card CSV.
 */

export interface StarterCardRow {
	/** What is still to send, in cents. Always above zero: a card with nothing owed is not a row. */
	amountCents: number
	email: string
	projectId: string
	title: string
}

/** The import file for every new card. Each one is the parts + PCB grant, with the same purpose and wording as every other grant. */
export function starterCardCsv(rows: readonly StarterCardRow[], origin: string | null): string {
	const lines = [GRANT_CARD_CSV_HEADER.join(",")]
	for (const row of rows) {
		const fields = [
			row.email,
			String(row.amountCents),
			grantCardPurpose(row.title),
			grantCardInstructions(row.title, row.projectId, origin),
			"false",
			"false",
			GRANT_CARD_INVITE_MESSAGE,
			"",
			"",
			"",
			"",
			"",
		]
		lines.push(fields.map(quoteField).join(","))
	}
	return `${lines.join("\n")}\n`
}
