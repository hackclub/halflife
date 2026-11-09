import { GRANT_CARD_INVITE_MESSAGE, grantCardInstructions, grantCardPurpose } from "@/lib/grant-card-policy"

/**
 * The `card_grants_template.csv` rows Half Life writes for the organisation's bulk import, one row per grant.
 *
 * Kept pure so the template can be pinned by tests: the column order and the field quoting have to survive any
 * refactor, because HCB's importer reads the header by name and a renamed or re-quoted column fails the whole
 * upload.
 */
export interface GrantCardCsvRow {
	amountCents: number
	email: string
	projectId: string
	title: string
}

/** The import template's header, in the order it is written. */
export const GRANT_CARD_CSV_HEADER = [
	"email",
	"amount_cents",
	"purpose",
	"instructions",
	"one_time_use",
	"pre_authorization_required",
	"invite_message",
	"merchant_lock",
	"category_lock",
	"keyword_lock",
	"banned_merchants",
	"banned_categories",
]

/**
 * One field as CSV: quoted when it holds a comma, quote or newline, inner quotes doubled.
 *
 * A project title with a comma lands in `instructions`, so this is not a nice-to-have: an unquoted comma would
 * shift every column after it and HCB would read the wrong amount.
 */
function quoteField(field: string): string {
	if (!/[",\n\r]/.test(field)) return field
	return `"${field.replaceAll('"', '""')}"`
}

/**
 * Render the import file for prepared rows.
 *
 * The organisation's template pre-fills from Cash, one grant per line. Cards are reusable (`one_time_use` and
 * `pre_authorization_required` stay false), so there are no locks or banned lists: the line is one grant, called
 * with the same words the v4 create would send.
 */
export function grantCardCsv(rows: readonly GrantCardCsvRow[]): string {
	const lines = [GRANT_CARD_CSV_HEADER.join(",")]
	for (const row of rows) {
		const fields = [
			row.email,
			String(row.amountCents),
			grantCardPurpose(row.projectId),
			grantCardInstructions(row.title),
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
