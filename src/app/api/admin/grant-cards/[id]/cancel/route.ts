import { ok } from "@/lib/api"
import { cancelGrantCard } from "@/lib/grant-cards"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

interface Params {
	params: Promise<{ id: string }>
}

export const maxDuration = 60

/** Cancel a live card grant and return its remaining balance to the organisation. */
export const POST = withWritePermission(
	Permission.MANAGE_CREDIT,
	async (_req: Request, { gate, params }: Params & AuthedContext) => {
		const { id } = await params
		return ok(await cancelGrantCard(id, { email: gate.user.email, id: gate.user.id }))
	},
)
