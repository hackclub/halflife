import { z } from "zod"

/**
 * One parts-list line, as the BOM routes send it.
 *
 * JSON carries the timestamp as a string, and the editor works with a `Date`, so the schema coerces it. Kept out of `lib/bom.ts` because that module is server-only and the editor is a client component.
 */
export const BomLineSchema = z.object({
	id: z.string(),
	link: z.string().nullable(),
	name: z.string(),
	purpose: z.string().nullable(),
	quantity: z.number(),
	unitCostUsd: z.number(),
	updatedAt: z.coerce.date(),
	vendor: z.string().nullable(),
})
export type BomLine = z.infer<typeof BomLineSchema>
