import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { dollars } from "@/lib/money"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { sanitize } from "@/lib/sanitize"
import { shopItemUpdateSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

export const PATCH = withPermission(
	Permission.MANAGE_SHOP,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, shopItemUpdateSchema)
		if (parsed.error) return parsed.error
		const { data } = parsed

		const before = await db.orm.public.ShopItem.whereUnique({ id }).first()
		if (!before) return fail("NOT_FOUND", "Item not found")

		const item = await db.orm.public.ShopItem.where({ id }).update({
			...data,
			...(data.name !== undefined ? { name: sanitize(data.name) } : {}),
			...(data.description !== undefined ? { description: sanitize(data.description) } : {}),
			...(data.costUsd !== undefined ? { costUsd: dollars(data.costUsd) } : {}),
		})
		if (!item) return fail("NOT_FOUND", "Item not found")

		await logAudit({
			action: AuditAction.ADMIN_UPDATE_SHOP_ITEM,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			// Everything the edit form can change. Category and gating decide who can buy an item and with which coins, so a change to them has to be traceable.
			metadata: {
				after: {
					active: item.active,
					category: item.category,
					costUsd: item.costUsd,
					imageUrl: item.imageUrl,
					maxPerUser: item.maxPerUser,
					name: item.name,
					priceCredits: item.priceCredits,
					requiresPrinterQualified: item.requiresPrinterQualified,
					sortOrder: item.sortOrder,
					stock: item.stock,
				},
				before: {
					active: before.active,
					category: before.category,
					costUsd: before.costUsd,
					imageUrl: before.imageUrl,
					maxPerUser: before.maxPerUser,
					name: before.name,
					priceCredits: before.priceCredits,
					requiresPrinterQualified: before.requiresPrinterQualified,
					sortOrder: before.sortOrder,
					stock: before.stock,
				},
			},
			targetId: id,
			targetType: "ShopItem",
		})

		return ok({ item })
	},
)

/**
 * Retire, never delete: orders reference the item forever, and "retired" is a different concept from "deleted".
 */
export const DELETE = withPermission(
	Permission.MANAGE_SHOP,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const before = await db.orm.public.ShopItem.whereUnique({ id }).first()
		if (!before) return fail("NOT_FOUND", "Item not found")

		const item = await db.orm.public.ShopItem.where({ id }).update({ active: false })
		if (!item) return fail("NOT_FOUND", "Item not found")

		await logAudit({
			action: AuditAction.ADMIN_RETIRE_SHOP_ITEM,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { after: { active: false }, before: { active: before.active } },
			targetId: id,
			targetType: "ShopItem",
		})

		return ok({ item })
	},
)
