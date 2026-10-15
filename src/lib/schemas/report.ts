import { z } from "zod"
import { ReportReason, ReportTarget } from "@/app/generated/prisma/enums"
import { boundedText, cuid } from "@/lib/schemas/common"

/**
 * One participant flagging user-generated content for staff.
 *
 * `targetId` is the row being reported – a post, comment, project, user or work session id, depending on `target`. The route checks it names a live row the reporter did not write, and that they do not already have an open report on it, so the queue cannot be flooded by repeats.
 */
export const createReportSchema = z
	.object({
		/** Optional context in the reporter's own words. */
		details: boundedText(2000).optional(),
		reason: z.enum(ReportReason),
		target: z.enum(ReportTarget),
		targetId: cuid,
	})
	.strict()
