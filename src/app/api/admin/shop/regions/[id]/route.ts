import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { shopRegionUpdateSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export const PATCH = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_SHOP)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, shopRegionUpdateSchema)
	if (parsed.error) return parsed.error
	const data = parsed.data

	const before = await prisma.shopRegion.findUnique({ where: { id } })
	if (!before) return fail("NOT_FOUND", "Region not found")

	const region = await prisma.shopRegion.update({ where: { id }, data })

	await logAudit({
		action: AuditAction.ADMIN_UPDATE_SHOP_REGION,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ShopRegion",
		targetId: id,
		metadata: {
			before: { name: before.name, sortOrder: before.sortOrder, active: before.active },
			after: { name: region.name, sortOrder: region.sortOrder, active: region.active },
		},
	})

	return ok({ region })
})
