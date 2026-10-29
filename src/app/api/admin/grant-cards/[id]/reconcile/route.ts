import { ok } from "@/lib/api"
import { reconcileGrantCard } from "@/lib/grant-cards"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

interface Params {
	params: Promise<{ id: string }>
}

export const maxDuration = 60

/** Ask HCB whether an ambiguous attempt actually created a grant. */
export const POST = withWritePermission(
	Permission.MANAGE_CREDIT,
	async (_req: Request, { gate, params }: Params & AuthedContext) => {
		const { id } = await params
		return ok(await reconcileGrantCard(id, { email: gate.user.email, id: gate.user.id }))
	},
)
