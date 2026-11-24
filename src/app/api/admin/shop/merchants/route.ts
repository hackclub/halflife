import { ok, parseBody } from "@/lib/api"
import { createGrantCardMerchant } from "@/lib/grant-card-merchant-admin"
import { withPermission, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { grantCardMerchantSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

/** Every grant card merchant, with how many shop items link to it. */
export const GET = withPermission(Permission.MANAGE_SHOP, async () => {
	const [merchants, links] = await Promise.all([
		db.orm.public.GrantCardMerchant.orderBy(merchant => merchant.name.asc()).all(),
		db.orm.public.ShopItemGrantCardMerchant.select("merchantId").all(),
	])
	const counts = new Map<string, number>()
	for (const link of links) counts.set(link.merchantId, (counts.get(link.merchantId) ?? 0) + 1)
	return ok({
		merchants: merchants.map(merchant => ({ ...merchant, itemCount: counts.get(merchant.id) ?? 0 })),
	})
})

export const POST = withWritePermission(Permission.MANAGE_SHOP, async (req: Request, { gate }) => {
	const parsed = await parseBody(req, grantCardMerchantSchema)
	if (parsed.error) return parsed.error
	const { data } = parsed
	const merchant = await createGrantCardMerchant(
		{ merchantIds: data.merchantIds, name: data.name, sourceNote: data.sourceNote },
		gate.user,
	)
	return ok({ merchant }, { status: 201 })
})
