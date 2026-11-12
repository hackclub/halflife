import { GRANT_CARD_CSV_HEADER, quoteField } from "@/lib/grant-card-csv"
import {
	GRANT_CARD_INVITE_MESSAGE,
	grantCardInstructions,
	grantCardProjectUrl,
	grantCardPurpose,
} from "@/lib/grant-card-policy"

/**
 * The files the starter export writes, kept pure so they can be pinned by tests.
 *
 * The HCB import reads the header by name and a renamed or re-quoted column fails the whole upload, so the rows go through the same `quoteField` as every other card CSV.
 */

/** The purpose on a kit recipient's PCB card. It is the one card in the programme that says what it is for. */
export const PCB_CARD_PURPOSE = "Starbie PCB"

/** What a kit recipient is told the PCB card is for. */
export const PCB_CARD_INSTRUCTIONS = "Only spend this on a PCB for your Starbie kit"

export interface StarterCardRow {
	/** What is still to send, in cents. Always above zero: a card with nothing owed is not a row. */
	amountCents: number
	email: string
	fulfilment: "KIT_WITH_PCB_CARD" | "PARTS_CARD"
	projectId: string
	title: string
}

/** The import file for every card still owed. Kit recipients get the PCB card; everyone else gets the parts card. */
export function starterCardCsv(rows: readonly StarterCardRow[], origin: string | null): string {
	const lines = [GRANT_CARD_CSV_HEADER.join(",")]
	for (const row of rows) {
		const isPcb = row.fulfilment === "KIT_WITH_PCB_CARD"
		const link = grantCardProjectUrl(row.projectId, origin)
		const instructions = isPcb
			? `${PCB_CARD_INSTRUCTIONS}${link ? ` – ${link}` : ""}`
			: grantCardInstructions(row.title, row.projectId, origin)
		const fields = [
			row.email,
			String(row.amountCents),
			isPcb ? PCB_CARD_PURPOSE : grantCardPurpose(),
			instructions,
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

export interface KitShipRow {
	city: string
	country: string
	email: string
	line1: string
	line2: string
	name: string
	state: string
	zip: string
}

/** Tabs and newlines would break the one-line-per-maker shape, so they become spaces. */
function oneLine(value: string): string {
	return value.replaceAll(/[\t\r\n]+/g, " ").trim()
}

/** The kit shipping list: one line per kit, with the verified address. Written to a file, never to stdout, because it holds addresses. */
export function kitShippingTsv(rows: readonly KitShipRow[]): string {
	const header = ["name", "email", "line 1", "line 2", "city", "state", "zip", "country"]
	const lines = [header.join("\t")]
	for (const row of rows)
		lines.push(
			[row.name, row.email, row.line1, row.line2, row.city, row.state, row.zip, row.country]
				.map(v => oneLine(v))
				.join("\t"),
		)
	return `${lines.join("\n")}\n`
}

/** Whether Airtable's `Country` and the verified address country name the same place. Both must be present. */
export function countriesAgree(airtableCountry: string | null, addressCountry: string | null): boolean {
	if (!airtableCountry || !addressCountry) return false
	return airtableCountry.trim().toUpperCase() === addressCountry.trim().toUpperCase()
}
