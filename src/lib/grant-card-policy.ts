import { createHash } from "node:crypto"
import { bomTotalUsd, type PricedLine } from "@/lib/bom-policy"

/**
 * The parts of card-grant issuance that are pure.
 *
 * Kept out of `grant-cards.ts` so the amount, marker and fingerprint can be tested without a database or an HCB connection.
 */

/** The prefix that makes a grant findable after a create whose response was lost. */
export const GRANT_CARD_MARKER_PREFIX = "HL:"

/** What a card grant pays: the BOM total in cents, tax and shipping included. */
export function grantCardAmountCents(items: readonly PricedLine[], taxShippingUsd: number | null | undefined): number {
	if (items.length === 0) return 0
	return Math.round(bomTotalUsd(items, taxShippingUsd) * 100)
}

/** The stable purpose stored on HCB, used to reconcile an attempt against the organisation's grants. */
export function grantCardPurpose(projectId: string): string {
	return `Half Life parts – ${GRANT_CARD_MARKER_PREFIX}${projectId}`
}

/** A fingerprint of exactly what a preview offered, so a stale confirmation cannot issue a different amount. */
export function grantCardFingerprint(
	rows: readonly { amountCents: number; email: string; projectId: string }[],
): string {
	const ordered = rows
		.map(row => `${row.projectId}:${row.amountCents}:${row.email.trim().toLowerCase()}`)
		.toSorted((a, b) => a.localeCompare(b))
	return createHash("sha256").update(ordered.join("\n")).digest("hex")
}
