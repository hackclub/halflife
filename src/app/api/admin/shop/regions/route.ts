import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { shopRegionSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
	const gate = await requirePermission(Permission.MANAGE_SHOP)
	if (gate.error) return gate.error
	return ok({
		items: await prisma.shopRegion.findMany({
			orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
			select: {
				id: true,
				name: true,
				active: true,
				sortOrder: true,
				_count: { select: { prices: true } },
			},
		}),
	})
})

export const POST = withRoute(async (req: Request) => {
	const gate = await requirePermission(Permission.MANAGE_SHOP)
	if (gate.error) return gate.error

	const parsed = await parseBody(req, shopRegionSchema)
	if (parsed.error) return parsed.error
	const data = parsed.data

	const existing = await prisma.shopRegion.findUnique({ where: { id: data.id } })
	if (existing) return fail("CONFLICT", "A region with that id already exists")

	const region = await prisma.shopRegion.create({ data })

	await logAudit({
		action: AuditAction.ADMIN_CREATE_SHOP_REGION,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ShopRegion",
		targetId: region.id,
		metadata: { after: { name: region.name } },
	})

	return ok({ region }, { status: 201 })
})
