import { ok, parseBody } from "@/lib/api"
import { processCardGrantBatch } from "@/lib/grant-cards"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { grantCardProcessSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

export const maxDuration = 60

/**
 * Process the next chunk of a batch.
 *
 * The admin client calls this until it reports no rows left. Each call is short enough to survive the proxy timeout, and a closed tab leaves a resumable batch rather than half a request.
 */
export const POST = withWritePermission(
	Permission.MANAGE_CREDIT,
	async (req: Request, { gate, params }: Params & AuthedContext) => {
		const { id } = await params
		const parsed = await parseBody(req, grantCardProcessSchema)
		if (parsed.error) return parsed.error

		const result = await processCardGrantBatch({
			admin: { email: gate.user.email, id: gate.user.id },
			batchId: id,
			limit: parsed.data.limit,
		})
		return ok(result)
	},
)
