import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { shopRegionUpdateSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

export const PATCH = withPermission(
	Permission.MANAGE_SHOP,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, shopRegionUpdateSchema)
		if (parsed.error) return parsed.error
		const { data } = parsed

		const before = await prisma.shopRegion.findUnique({ where: { id } })
		if (!before) return fail("NOT_FOUND", "Region not found")

		const region = await prisma.shopRegion.update({ data, where: { id } })

		await logAudit({
			action: AuditAction.ADMIN_UPDATE_SHOP_REGION,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: {
				after: { active: region.active, name: region.name, sortOrder: region.sortOrder },
				before: { active: before.active, name: before.name, sortOrder: before.sortOrder },
			},
			targetId: id,
			targetType: "ShopRegion",
		})

		return ok({ region })
	},
)

export const dynamic = "force-dynamic"
