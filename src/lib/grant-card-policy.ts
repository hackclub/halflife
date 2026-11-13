import { createHash } from "node:crypto"
import { bomTotalUsd, type PricedLine } from "@/lib/bom-policy"
import { getTier } from "@/lib/config/tiers"
import { STARTER_TIER_ID, starterPartsCapUsd } from "@/lib/starter-funding"

/**
 * The parts of card-grant issuance that are pure.
 *
 * Kept out of `grant-cards.ts` so the amount, marker and fingerprint can be tested without a database or an HCB connection.
 */

/** The prefix that makes a grant findable after a create whose response was lost. */
export const GRANT_CARD_MARKER_PREFIX = "HL:"

/** The most HCB fits in a purpose, so whatever else goes in has to. */
export const GRANT_CARD_PURPOSE_MAX = 30

/** What every card's purpose starts with. */
export const GRANT_CARD_PURPOSE = "Half Life parts"

const PURPOSE_SEPARATOR = " – "

/**
 * The most a design's card may pay: the lower of its approved grant and its tier's `grantUsd`. Null when the project has no tier, because then there is no ceiling to hold it to.
 *
 * The tier check matters because an approved grant can be overridden by hand; the card still may not exceed the tier it was approved at.
 */
export function grantCardCapUsd(grantUsd: number | null, tier: number | null, weekOneStarter = false): number | null {
	// A Tier 1 Week 1 starter is paid the parts + PCB target, not its tier grant, so the cap is the starter cap.
	if (weekOneStarter && tier === STARTER_TIER_ID) return starterPartsCapUsd()
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
 * The purpose stored on HCB: the parts line, then the project's name, cut to the most HCB fits. The reconciler matches on equality here, so a card's purpose must be the one it was claimed with: a batch stores it on its row, and only a row from before that has none falls back to the bare line.
 */
export function grantCardPurpose(title?: string | null): string {
	const name = (title ?? "").replaceAll(/\s+/g, " ").trim()
	if (!name) return GRANT_CARD_PURPOSE
	const room = GRANT_CARD_PURPOSE_MAX - GRANT_CARD_PURPOSE.length - PURPOSE_SEPARATOR.length
	const cut = name.length <= room ? name : `${fitWhole(name, room - 1)}…`
	return `${GRANT_CARD_PURPOSE}${PURPOSE_SEPARATOR}${cut}`
}

/** The longest run of whole characters from the start that fits in `budget` UTF-16 units, so a surrogate pair is never split. */
function fitWhole(text: string, budget: number): string {
	let out = ""
	for (const char of text) {
		if (out.length + char.length > budget) break
		out += char
	}
	return out
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
