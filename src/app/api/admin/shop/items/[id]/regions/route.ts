import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { itemRegionPriceSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Set (or clear, with null) one region's coin price for one shop item. Absent means base pricing, so clearing restores the base price rather than deleting history – orders snapshot the price they were charged.
 */
export const PUT = withWritePermission(
	Permission.MANAGE_SHOP,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, itemRegionPriceSchema)
		if (parsed.error) return parsed.error
		const { regionId, priceCredits } = parsed.data

		const [item, region] = await Promise.all([
			db.orm.public.ShopItem.whereUnique({ id }).select("id", "priceCredits").first(),
			db.orm.public.ShopRegion.whereUnique({ id: regionId }).select("id", "name").first(),
		])
		if (!item) return fail("NOT_FOUND", "Item not found")
		if (!region) return fail("NOT_FOUND", "Region not found")

		const before = await db.orm.public.ShopItemRegionPrice.where({ regionId, shopItemId: id })
			.select("priceCredits")
			.first()

		if (priceCredits === null)
			await db.orm.public.ShopItemRegionPrice.where({ regionId, shopItemId: id }).deleteAndCount()
		else {
			const existing = await db.orm.public.ShopItemRegionPrice.where({ regionId, shopItemId: id }).select("id").first()
			if (existing) await db.orm.public.ShopItemRegionPrice.where({ id: existing.id }).update({ priceCredits })
			else await db.orm.public.ShopItemRegionPrice.create({ priceCredits, regionId, shopItemId: id })
		}

		await logAudit({
			action: AuditAction.ADMIN_SET_REGION_PRICE,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: {
				after: priceCredits ?? item.priceCredits,
				before: before?.priceCredits ?? item.priceCredits,
				regionId,
			},
			targetId: id,
			targetType: "ShopItem",
		})

		return ok({ priceCredits })
	},
)
