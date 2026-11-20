import { z } from "zod"
import { ok, parseBody } from "@/lib/api"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { saveUnifiedReview } from "@/lib/review-platform/unified"
import { boundedText } from "@/lib/schemas/common"

interface Params {
	params: Promise<{ id: string }>
}

export const maxDuration = 60

const bodySchema = z
	.object({
		approve: z.boolean().default(false),
		fields: z.record(z.string(), boundedText(20_000)).default({}),
		screenshots: z.array(boundedText(2000)).max(20).default([]),
	})
	.strict()

/**
 * T2: save an admin's fields for a website approval and write them to its Airtable row, or approve it, which also ticks `Automation - Submit to Unified YSWS` (see lib/review-platform/unified).
 *
 * REVIEW_UNIFIED is ADMIN's alone. The rules beyond it – not your own project, not an approval you made at T1, not one already sent – are enforced by `saveUnifiedReview`.
 */
export const POST = withWritePermission(
	Permission.REVIEW_UNIFIED,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const parsed = await parseBody(req, bodySchema)
		if (parsed.error) return parsed.error
		const { id } = await params
		return ok(await saveUnifiedReview(id, gate.user.id, parsed.data))
	},
)
