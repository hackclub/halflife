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

/** The badge colours a ledger kind can take. Each kind gets one, so the table reads by colour as well as by label. */
export type LedgerKindTone = "access" | "danger" | "gold" | "info" | "muted" | "sand" | "success" | "violet" | "warning"

/** Each entry kind's colour. Kinds that go out (purchases, reversals) read red, kinds that come in read green, and the rest take the palette's other inks so no two common kinds share a colour. */
const KIND_TONES: { [_: string]: LedgerKindTone } = {
	ADMIN_ADJUSTMENT: "access",
	BOM_SAVINGS: "muted",
	BUILD_BANKED_HOURS: "violet",
	BUILD_HOURS: "violet",
	DESIGN_BANKED_HOURS: "success",
	DESIGN_EXCESS_HOURS: "success",
	PARTS_TOP_UP: "warning",
	REVIEWER_PAYMENT: "sand",
	SHOP_PURCHASE: "info",
	SHOP_REFUND: "sand",
	THEME_COMPLETION_BONUS: "gold",
}

export const ledgerKindTone = (kind: LedgerKind): LedgerKindTone => KIND_TONES[kind] ?? "muted"
