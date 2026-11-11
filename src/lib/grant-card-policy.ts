import { createHash } from "node:crypto"
import { bomTotalUsd, type PricedLine } from "@/lib/bom-policy"
import { getTier } from "@/lib/config/tiers"

/**
 * The parts of card-grant issuance that are pure.
 *
 * Kept out of `grant-cards.ts` so the amount, marker and fingerprint can be tested without a database or an HCB connection.
 */

/** The prefix that makes a grant findable after a create whose response was lost. */
export const GRANT_CARD_MARKER_PREFIX = "HL:"

/** The most HCB fits in a purpose, so whatever else goes in has to. */
export const GRANT_CARD_PURPOSE = "Half Life parts"

/**
 * The most a design's card may pay: the lower of its approved grant and its tier's `grantUsd`. Null when the project has no tier, because then there is no ceiling to hold it to.
 *
 * The tier check matters because an approved grant can be overridden by hand; the card still may not exceed the tier it was approved at.
 */
export function grantCardCapUsd(grantUsd: number | null, tier: number | null): number | null {
	const tierUsd = tier === null ? undefined : getTier(tier)?.grantUsd
	if (tierUsd === undefined) return null
	return Math.min(grantUsd ?? 0, tierUsd)
}

/**
 * What a card grant pays: the BOM total in cents, tax and shipping included, never more than `capUsd`.
 *
 * The cap is the most a design can ever be granted: the tier's `grantUsd`, or the approved grant if that is lower. A cart over the cap is the maker's to cover, as the BOM editor says, so a card cannot be issued above it even when the parts list is bigger.
 */
export function grantCardAmountCents(
	items: readonly PricedLine[],
	taxShippingUsd: number | null | undefined,
	capUsd: number,
): number {
	if (items.length === 0) return 0
	return Math.min(Math.round(bomTotalUsd(items, taxShippingUsd) * 100), Math.round(capUsd * 100))
}

/**
 * The link Half Life points the recipient at: the origin the deployment was built with, so a dev server stays on
 * dev and staging stays off the live site.
 */
export function grantCardProjectUrl(projectId: string, origin: string | null): string | null {
	if (!origin) return null
	return `${origin.replace(/\/$/, "")}/projects/${projectId}`
}

/**
 * The purpose stored on HCB: short enough for the import's column, and the same words on every card. What says
 * which project it is for moves to the instructions instead – the reconciler matches on equality here, so the
 * discrimination rides with the amount and the recipient, never with the purpose.
 */
export function grantCardPurpose(): string {
	return GRANT_CARD_PURPOSE
}

/** What the maker is told the money is for. Shared by the v4 create and the CSV import row. */
export function grantCardInstructions(title: string, projectId: string, origin: string | null): string {
	const url = grantCardProjectUrl(projectId, origin)
	return `Parts for ${title || "your Half Life project"}${url ? ` – ${url}` : ""}`
}

/** The message HCB shows when it invites the maker to accept the card. Shared by the v4 create and the CSV row. */
export const GRANT_CARD_INVITE_MESSAGE = "Your Half Life parts grant is ready. Accept it to get your card."

/** A fingerprint of exactly what a preview offered, so a stale confirmation cannot issue a different amount. */
export function grantCardFingerprint(
	rows: readonly { amountCents: number; email: string; projectId: string }[],
): string {
	const ordered = rows
		.map(row => `${row.projectId}:${row.amountCents}:${row.email.trim().toLowerCase()}`)
		.toSorted((a, b) => a.localeCompare(b))
	return createHash("sha256").update(ordered.join("\n")).digest("hex")
}
