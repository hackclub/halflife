import "server-only"
import type { Models } from "@/app/generated/prisma8/contract.d"
import { syncProjectBomToYsws } from "@/lib/airtable/sync"
import { bomTotalUsd, type PartsFunding, partsFunding } from "@/lib/bom-policy"
import type { BomLine } from "@/lib/bom-schema"
import { ENTRY_TIER, getTier, projectTierId } from "@/lib/config/tiers"
import { Phase, PhaseStatus } from "@/lib/enums"
import { round2 } from "@/lib/money"
import db from "@/lib/prisma8"
import { withFields } from "@/lib/rows"
import { sanitize, sanitizeOptional } from "@/lib/sanitize"
import type { BomItemInput } from "@/lib/schemas/project"
import { trackSideEffect } from "@/lib/side-effects"
import { parseDbTimestamp } from "@/lib/time"

/**
 * A project's bill of materials – the parts list the tier's funding is asked against, kept on the project page and handed in with the design week.
 */

/** Plenty for a hand-built board, and a ceiling on a runaway script. */
export const MAX_BOM_ITEMS = 80

export type { BomLine } from "@/lib/bom-schema"

/**
 * What this project's parts list asks against the tier it is asking for, read from the database.
 *
 * The submit gate's side of the rule in `lib/bom-policy`, and deliberately not the sheet's: the numbers here are the ones the maker is bound by, worked out from the stored cart and the stored tier request rather than from whatever was on screen when they pressed submit.
 *
 * The tier comes from `projectTierId`, which is the maker's request until the design is approved and the reviewer's decision after – never a `tier` value written before a decision, which is what imported rows carry. A build never asks for parts money, so its total is nothing and it can never need agreeing to anything.
 */
export async function partsFundingFor(
	project: Pick<Models.public_ThemeProject, "designStatus" | "id" | "tier" | "requestedTier" | "bomTaxShippingUsd">,
	phase: Phase,
): Promise<PartsFunding> {
	const capUsd = getTier(projectTierId(project))?.grantUsd ?? ENTRY_TIER.grantUsd
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
 * In review for the same reason the project itself is: editing what a reviewer is reading changes the thing being decided halfway through. Final once a phase is rejected: a rejected design is the record its decision was made against, and its parts list is what any later re-approval would pay.
 *
 * An approved phase stays editable. The list is kept in step with the project's Airtable row (see `syncProjectBomToYsws`), so a change made after approval reaches the row the pipeline reads.
 */
export function bomLockReason(project: { designStatus: PhaseStatus; buildStatus: PhaseStatus }): string | null {
	if (project.designStatus === PhaseStatus.in_review || project.buildStatus === PhaseStatus.in_review)
		return "A phase is in review, so unsubmit before editing"
	if (project.designStatus === PhaseStatus.rejected) return "The design week is decided, so the parts list is final"
	if (project.buildStatus === PhaseStatus.rejected) return "The build week is decided, so the parts list is final"
	return null
}

/**
 * Carry a parts-list change to the project's Airtable row. Called after the response, from every route that writes the list, so the row and the list cannot drift apart. Logged as a side effect like any other, so a failure is visible in the audit log.
 */
export function syncBomToAirtable(themeProjectId: string, actor: { email: string; id: string }): Promise<unknown> {
	return trackSideEffect(
		"airtable",
		{
			actorEmail: actor.email,
			actorId: actor.id,
			metadata: { partsList: true },
			targetId: themeProjectId,
			targetType: "ThemeProject",
		},
		() => syncProjectBomToYsws(themeProjectId),
	)
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
		...(input.name === undefined ? {} : { name: sanitize(input.name) }),
		...(input.purpose === undefined ? {} : { purpose: sanitizeOptional(input.purpose) }),
		...(input.quantity === undefined ? {} : { quantity: input.quantity }),
		...(input.unitCostUsd === undefined ? {} : { unitCostUsd: round2(input.unitCostUsd) }),
		...(input.vendor === undefined ? {} : { vendor: sanitizeOptional(input.vendor) }),
		...(input.link === undefined ? {} : { link: input.link || null }),
	}
}
