import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { shopRegionSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

export const GET = withPermission(Permission.MANAGE_SHOP, async () =>
	ok({
		items: await prisma.shopRegion.findMany({
			orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
			select: {
				_count: { select: { prices: true } },
				active: true,
				id: true,
				name: true,
				sortOrder: true,
			},
		}),
	}),
)

export const POST = withPermission(Permission.MANAGE_SHOP, async (req: Request, { gate }) => {
	const parsed = await parseBody(req, shopRegionSchema)
	if (parsed.error) return parsed.error
	const { data } = parsed

	const existing = await prisma.shopRegion.findUnique({ where: { id: data.id } })
	if (existing) return fail("CONFLICT", "A region with that id already exists")

	const region = await prisma.shopRegion.create({ data })

	await logAudit({
		action: AuditAction.ADMIN_CREATE_SHOP_REGION,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { after: { name: region.name } },
		targetId: region.id,
		targetType: "ShopRegion",
	})

	return ok({ region }, { status: 201 })
})
