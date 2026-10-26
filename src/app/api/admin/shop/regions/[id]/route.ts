import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { shopRegionUpdateSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

export const PATCH = withWritePermission(
	Permission.MANAGE_SHOP,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, shopRegionUpdateSchema)
		if (parsed.error) return parsed.error
		const { data } = parsed

		const before = await db.orm.public.ShopRegion.whereUnique({ id }).first()
		if (!before) return fail("NOT_FOUND", "Region not found")

		const region = await db.orm.public.ShopRegion.where({ id }).update(data)
		if (!region) return fail("NOT_FOUND", "Region not found")

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
