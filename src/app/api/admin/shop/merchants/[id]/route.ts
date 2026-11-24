import { ok, parseBody } from "@/lib/api"
import { deleteGrantCardMerchant, updateGrantCardMerchant } from "@/lib/grant-card-merchant-admin"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { grantCardMerchantUpdateSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

export const PATCH = withWritePermission(
	Permission.MANAGE_SHOP,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params
		const parsed = await parseBody(req, grantCardMerchantUpdateSchema)
		if (parsed.error) return parsed.error
		const merchant = await updateGrantCardMerchant(id, parsed.data, gate.user)
		return ok({ merchant })
	},
)

export const DELETE = withWritePermission(
	Permission.MANAGE_SHOP,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params
		await deleteGrantCardMerchant(id, gate.user)
		return ok({ deleted: true })
	},
)
