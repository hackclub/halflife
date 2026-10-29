import { z } from "zod"
import { boundedText } from "@/lib/schemas/common"

/**
 * The dashboard NPS score, asked first and blocking. The three text answers ride along optionally and are also asked again later, unblocking, from the corner nudge.
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
 * The follow-up texts, asked after the score from the corner nudge. All optional and possibly all empty – sending nothing to add still counts as answered on the device that sent it.
 */
export const npsTextsSubmitSchema = z
	.object({
		howDoingWell: boundedText(2000).optional().nullable(),
		howHear: boundedText(2000).optional().nullable(),
		howImprove: boundedText(2000).optional().nullable(),
	})
	.strict()

export type NpsTextsSubmit = z.output<typeof npsTextsSubmitSchema>
