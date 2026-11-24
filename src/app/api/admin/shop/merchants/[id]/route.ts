import { ok, parseBody } from "@/lib/api"
import { setGrantCardMerchantArchived, updateGrantCardMerchant } from "@/lib/grant-card-merchant-admin"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { grantCardMerchantUpdateSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

/** Edit a merchant, or archive and restore it with `archived`. */
export const PATCH = withWritePermission(
	Permission.MANAGE_SHOP,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params
		const parsed = await parseBody(req, grantCardMerchantUpdateSchema)
		if (parsed.error) return parsed.error
		const { archived, ...fields } = parsed.data
		if (archived !== undefined) await setGrantCardMerchantArchived(id, archived, gate.user)
		if (Object.keys(fields).length > 0) await updateGrantCardMerchant(id, fields, gate.user)
		return ok({ archived: archived ?? null })
	},
)
