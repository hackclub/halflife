import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { itemRegionPriceSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Set (or clear, with null) one region's coin price for one shop item. Absent means base pricing, so clearing restores the base price rather than deleting history – orders snapshot the price they were charged.
 */
export const PUT = withPermission(
	Permission.MANAGE_SHOP,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, itemRegionPriceSchema)
		if (parsed.error) return parsed.error
		const { regionId, priceCredits } = parsed.data

		const [item, region] = await Promise.all([
			prisma.shopItem.findUnique({ select: { id: true, priceCredits: true }, where: { id } }),
			prisma.shopRegion.findUnique({ select: { id: true, name: true }, where: { id: regionId } }),
		])
		if (!item) return fail("NOT_FOUND", "Item not found")
		if (!region) return fail("NOT_FOUND", "Region not found")

		const before = await prisma.shopItemRegionPrice.findUnique({
			select: { priceCredits: true },
			where: { shopItemId_regionId: { regionId, shopItemId: id } },
		})

		if (priceCredits === null) await prisma.shopItemRegionPrice.deleteMany({ where: { regionId, shopItemId: id } })
		else
			await prisma.shopItemRegionPrice.upsert({
				create: { priceCredits, regionId, shopItemId: id },
				update: { priceCredits },
				where: { shopItemId_regionId: { regionId, shopItemId: id } },
			})

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

export const dynamic = "force-dynamic"
