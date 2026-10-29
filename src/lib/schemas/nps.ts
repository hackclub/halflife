import { z } from "zod"
import { boundedText } from "@/lib/schemas/common"

/**
 * The dashboard's NPS follow-up, mirroring the four columns on the Signups table.
 *
 * Only the 0-10 score is required: the prompt is answered once a score is on the row, and the three text answers ride along and may be empty. Trimmed before the length check so whitespace alone is not an answer.
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
