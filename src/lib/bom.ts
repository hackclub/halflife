import "server-only"
import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import type { Models } from "@/app/generated/prisma8/contract.d"
import { bomTotalUsd, type PartsFunding, partsFunding } from "@/lib/bom-policy"
import { ENTRY_TIER, getTier } from "@/lib/config/tiers"
import { round2 } from "@/lib/money"
import db from "@/lib/prisma8"
import { withFields } from "@/lib/rows"
import { sanitize, sanitizeOptional } from "@/lib/sanitize"
import type { BomItemInput } from "@/lib/schemas/project"
import { parseDbTimestamp } from "@/lib/time"

/**
 * A project's bill of materials – the parts list the tier's funding is asked against, kept on the project page and handed in with the design week.
 */

/** Plenty for a hand-built board, and a ceiling on a runaway script. */
export const MAX_BOM_ITEMS = 80

export interface BomLine {
	id: string
	link: string | null
	name: string
	purpose: string | null
	quantity: number
	unitCostUsd: number
	updatedAt: Date
	vendor: string | null
}

/**
 * What this project's parts list asks against the tier it is asking for, read from the database.
 *
 * The submit gate's side of the rule in `lib/bom-policy`, and deliberately not the sheet's: the numbers here are the ones the maker is bound by, worked out from the stored cart and the stored tier request rather than from whatever was on screen when they pressed submit.
 *
 * `requestedTier` is the maker's ask and `tier` the reviewer's decision, so a project whose design is already approved is priced against what was actually paid out. A build never asks for parts money, so its total is nothing and it can never need agreeing to anything.
 */
export async function partsFundingFor(
	project: Pick<Models.public_ThemeProject, "id" | "tier" | "requestedTier" | "bomTaxShippingUsd">,
	phase: Phase,
): Promise<PartsFunding> {
	const capUsd = getTier(project.tier ?? project.requestedTier ?? ENTRY_TIER.id)?.grantUsd ?? ENTRY_TIER.grantUsd
	if (phase !== Phase.DESIGN) return partsFunding(0, capUsd)
	const items = await db.orm.public.BomItem.where({ themeProjectId: project.id })
		.select("quantity", "unitCostUsd")
		.all()
	return partsFunding(bomTotalUsd(items, project.bomTaxShippingUsd), capUsd)
}

export async function listBom(themeProjectId: string): Promise<BomLine[]> {
	const rows = await db.orm.public.BomItem.where({ themeProjectId })
		.orderBy([item => item.sortOrder.asc(), item => item.createdAt.asc()])
		.select("id", "link", "name", "purpose", "quantity", "unitCostUsd", "updatedAt", "vendor")
		.all()
	return rows.map(row => withFields(row, { updatedAt: parseDbTimestamp(row.updatedAt) }))
}

/**
 * Why the list cannot change right now, or null when it can.
 *
 * In review for the same reason the project itself is: editing what a reviewer is reading changes the thing being decided halfway through. And final once the design is approved, because that approval is what paid the tier out against this list.
 */
export function bomLockReason(project: { designStatus: PhaseStatus; buildStatus: PhaseStatus }): string | null {
	if (project.designStatus === PhaseStatus.in_review || project.buildStatus === PhaseStatus.in_review)
		return "Unsubmit before editing – a phase is in review"
	if (project.designStatus === PhaseStatus.approved) return "The design week is approved, so the parts list is final"
	return null
}

/** The fields a write may set, cleaned the way every other maker text is. */
export function bomData(input: Partial<BomItemInput>): {
	name?: string
	purpose?: string | null
	quantity?: number
	unitCostUsd?: number
	vendor?: string | null
	link?: string | null
} {
	return {
		...(input.name !== undefined ? { name: sanitize(input.name) } : {}),
		...(input.purpose !== undefined ? { purpose: sanitizeOptional(input.purpose) } : {}),
		...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
		...(input.unitCostUsd !== undefined ? { unitCostUsd: round2(input.unitCostUsd) } : {}),
		...(input.vendor !== undefined ? { vendor: sanitizeOptional(input.vendor) } : {}),
		...(input.link !== undefined ? { link: input.link || null } : {}),
	}
}
