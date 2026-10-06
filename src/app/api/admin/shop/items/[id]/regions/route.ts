import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { itemRegionPriceSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Set (or clear, with null) one region's coin price for one shop item.
 * Absent means base pricing, so clearing restores the base price rather than
 * deleting history — orders snapshot the price they were charged.
 */
export const PUT = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_SHOP)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, itemRegionPriceSchema)
	if (parsed.error) return parsed.error
	const { regionId, priceCredits } = parsed.data

	const [item, region] = await Promise.all([
		prisma.shopItem.findUnique({ where: { id }, select: { id: true, priceCredits: true } }),
		prisma.shopRegion.findUnique({ where: { id: regionId }, select: { id: true, name: true } }),
	])
	if (!item) return fail("NOT_FOUND", "Item not found")
	if (!region) return fail("NOT_FOUND", "Region not found")

	const before = await prisma.shopItemRegionPrice.findUnique({
		where: { shopItemId_regionId: { shopItemId: id, regionId } },
		select: { priceCredits: true },
	})

	if (priceCredits === null) {
		await prisma.shopItemRegionPrice.deleteMany({ where: { shopItemId: id, regionId } })
	} else {
		await prisma.shopItemRegionPrice.upsert({
			where: { shopItemId_regionId: { shopItemId: id, regionId } },
			create: { shopItemId: id, regionId, priceCredits },
			update: { priceCredits },
		})
	}

	await logAudit({
		action: AuditAction.ADMIN_SET_REGION_PRICE,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ShopItem",
		targetId: id,
		metadata: {
			regionId,
			before: before?.priceCredits ?? item.priceCredits,
			after: priceCredits ?? item.priceCredits,
		},
	})

	return ok({ priceCredits })
})
