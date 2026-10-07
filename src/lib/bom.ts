import "server-only"
import { PhaseStatus } from "@/app/generated/prisma/enums"
import prisma from "@/lib/prisma"
import { sanitize, sanitizeOptional } from "@/lib/sanitize"
import type { BomItemInput } from "@/lib/schemas/project"

/**
 * A project's bill of materials – the parts list the tier's funding is asked against, kept on the project page and handed in with the design week.
 */

/** Plenty for a hand-built board, and a ceiling on a runaway script. */
export const MAX_BOM_ITEMS = 80

export interface BomLine {
	id: string
	name: string
	purpose: string | null
	quantity: number
	unitCostUsd: number
	vendor: string | null
	link: string | null
	updatedAt: Date
}

export function listBom(themeProjectId: string): Promise<BomLine[]> {
	return prisma.bomItem.findMany({
		where: { themeProjectId },
		orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
		select: {
			id: true,
			name: true,
			purpose: true,
			quantity: true,
			unitCostUsd: true,
			vendor: true,
			link: true,
			updatedAt: true,
		},
	})
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
export function bomData(input: Partial<BomItemInput>) {
	return {
		...(input.name !== undefined ? { name: sanitize(input.name) } : {}),
		...(input.purpose !== undefined ? { purpose: sanitizeOptional(input.purpose) } : {}),
		...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
		...(input.unitCostUsd !== undefined ? { unitCostUsd: Math.round(input.unitCostUsd * 100) / 100 } : {}),
		...(input.vendor !== undefined ? { vendor: sanitizeOptional(input.vendor) } : {}),
		...(input.link !== undefined ? { link: input.link || null } : {}),
	}
}
