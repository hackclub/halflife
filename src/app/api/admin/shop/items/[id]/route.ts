import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { dollars } from "@/lib/money"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { sanitize } from "@/lib/sanitize"
import { shopItemUpdateSchema } from "@/lib/schemas/admin"

type Params = { params: Promise<{ id: string }> }

export const PATCH = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_SHOP)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, shopItemUpdateSchema)
	if (parsed.error) return parsed.error
	const data = parsed.data

	const before = await prisma.shopItem.findUnique({ where: { id } })
	if (!before) return fail("NOT_FOUND", "Item not found")

	const item = await prisma.shopItem.update({
		where: { id },
		data: {
			...data,
			...(data.name !== undefined ? { name: sanitize(data.name) } : {}),
			...(data.description !== undefined ? { description: sanitize(data.description) } : {}),
			...(data.costUsd !== undefined ? { costUsd: dollars(data.costUsd) } : {}),
		},
	})

	await logAudit({
		action: AuditAction.ADMIN_UPDATE_SHOP_ITEM,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ShopItem",
		targetId: id,
		// Everything the edit form can change. Category and gating decide who can
		// buy an item and with which coins, so a change to them has to be traceable.
		metadata: {
			before: {
				name: before.name,
				category: before.category,
				priceCredits: before.priceCredits,
				costUsd: before.costUsd,
				maxPerUser: before.maxPerUser,
				stock: before.stock,
				requiresPrinterQualified: before.requiresPrinterQualified,
				imageUrl: before.imageUrl,
				sortOrder: before.sortOrder,
				active: before.active,
			},
			after: {
				name: item.name,
				category: item.category,
				priceCredits: item.priceCredits,
				costUsd: item.costUsd,
				maxPerUser: item.maxPerUser,
				stock: item.stock,
				requiresPrinterQualified: item.requiresPrinterQualified,
				imageUrl: item.imageUrl,
				sortOrder: item.sortOrder,
				active: item.active,
			},
		},
	})

	return ok({ item })
})

/**
 * Retire, never delete: orders reference the item forever, and "retired" is a
 * different concept from "deleted".
 */
export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_SHOP)
	if (gate.error) return gate.error
	const { id } = await params

	const before = await prisma.shopItem.findUnique({ where: { id } })
	if (!before) return fail("NOT_FOUND", "Item not found")

	const item = await prisma.shopItem.update({ where: { id }, data: { active: false } })

	await logAudit({
		action: AuditAction.ADMIN_RETIRE_SHOP_ITEM,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ShopItem",
		targetId: id,
		metadata: { before: { active: before.active }, after: { active: false } },
	})

	return ok({ item })
})
