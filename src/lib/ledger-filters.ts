import { LedgerKind } from "@/lib/enums"

/**
 * The ledger page's URL filters, read as values the query can use.
 *
 * Kept apart from the query so the parsing is pure: a hand-edited URL is a page that shows the unfiltered list, never a server error.
 */

/** A date input's `YYYY-MM-DD` as midnight UTC; anything else is dropped. */
export function utcDay(value: string | undefined): Date | undefined {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
	const day = new Date(`${value}T00:00:00Z`)
	return Number.isNaN(day.getTime()) ? undefined : day
}

/** The chosen kind, or nothing when the URL names one the ledger does not record. An unknown kind reads as "any kind". */
export const ledgerKindFrom = (value: string | undefined): LedgerKind | undefined =>
	Object.values(LedgerKind).find(kind => kind === value)

/** A kind as a person reads it, for the filter menu and the row's badge: `DESIGN_BANKED_HOURS` becomes "Design banked hours". */
export function ledgerKindLabel(kind: LedgerKind): string {
	const words = kind.toLowerCase().replaceAll("_", " ")
	return words.charAt(0).toUpperCase() + words.slice(1)
}
