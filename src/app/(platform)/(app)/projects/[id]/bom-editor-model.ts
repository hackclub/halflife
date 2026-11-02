import { z } from "zod"
import { type BomLine, BomLineSchema } from "@/lib/bom-schema"

/** What the import route reports after reading the repo's CSV. */
export const ImportPreviewSchema = z.object({
	/** Lines already on the page, so the copy can offer add vs replace. */
	existing: z.number(),
	lines: z.array(
		z.object({
			link: z.string().nullable(),
			name: z.string(),
			purpose: z.string().nullable(),
			quantity: z.number(),
			unitCostUsd: z.number(),
			vendor: z.string().nullable(),
		}),
	),
	path: z.string(),
	skipped: z.array(z.object({ name: z.string(), reason: z.string(), row: z.number() })),
})

export type ImportPreview = z.infer<typeof ImportPreviewSchema>

/** The BOM routes' success payload, plus the error envelope they share. */
export const BomPayloadSchema = z.object({
	error: z
		.object({
			code: z.string().optional(),
			details: z.object({ properties: z.record(z.string(), z.unknown()).optional() }).optional(),
			message: z.string().optional(),
		})
		.optional(),
	items: z.array(BomLineSchema).optional(),
	taxShippingUsd: z.number().optional(),
})

export interface Draft {
	link: string
	name: string
	purpose: string
	quantity: string
	unitCostUsd: string
	vendor: string
}

export const FIELD_NAMES: Record<keyof Draft, string> = {
	link: "Link",
	name: "Part",
	purpose: "What it's for",
	quantity: "Qty",
	unitCostUsd: "Unit $",
	vendor: "Vendor",
}

/** "Fill out the required fields", naming the ones that are missing. */
export function requiredMessage(fields: (keyof Draft)[]): string {
	return `Fill out the required fields: ${fields.map(k => FIELD_NAMES[k]).join(", ")}.`
}

export const EMPTY: Draft = { link: "", name: "", purpose: "", quantity: "1", unitCostUsd: "", vendor: "" }

/**
 * Pasted prices often carry a `$` (`$12.50`) or commas (`1,299.99`), which `Number` would reject. Strip them so pasting just works.
 */
export function parsePrice(value: string): number {
	const cleaned = value.replaceAll("$", "").replaceAll(",", "").trim()
	return cleaned ? Number(cleaned) : Number.NaN
}

export function draftOf(line: BomLine): Draft {
	return {
		link: line.link ?? "",
		name: line.name,
		purpose: line.purpose ?? "",
		quantity: String(line.quantity),
		unitCostUsd: line.unitCostUsd ? String(line.unitCostUsd) : "",
		vendor: line.vendor ?? "",
	}
}
