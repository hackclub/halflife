import { z } from "zod"
import { boundedText } from "@/lib/schemas/common"

/**
 * The dashboard NPS score, asked first and blocking. The three text answers ride along optionally and are also asked again later, blocking, from the follow-up.
 */
export const npsSubmitSchema = z
	.object({
		howDoingWell: boundedText(2000).optional().nullable(),
		howHear: boundedText(2000).optional().nullable(),
		howImprove: boundedText(2000).optional().nullable(),
		howLikelyRecommend: z.number().int().min(0).max(10),
	})
	.strict()

export type NpsSubmit = z.output<typeof npsSubmitSchema>

/**
 * The follow-up texts, asked after the score. At least one text is required by the form, though this schema still accepts an empty body; the score may be revised alongside them.
 */
export const npsTextsSubmitSchema = z
	.object({
		howDoingWell: boundedText(2000).optional().nullable(),
		howHear: boundedText(2000).optional().nullable(),
		howImprove: boundedText(2000).optional().nullable(),
		howLikelyRecommend: z.number().int().min(0).max(10).optional(),
	})
	.strict()

export type NpsTextsSubmit = z.output<typeof npsTextsSubmitSchema>
