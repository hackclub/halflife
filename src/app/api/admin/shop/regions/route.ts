import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { withPermission, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { shopRegionSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

export const GET = withPermission(Permission.MANAGE_SHOP, async () =>
	ok({
		items: await db.orm.public.ShopRegion.orderBy([region => region.sortOrder.asc(), region => region.name.asc()])
			.select("active", "id", "name", "sortOrder")
			.include("prices", prices => prices.count())
			.all(),
	}),
)

export const POST = withWritePermission(Permission.MANAGE_SHOP, async (req: Request, { gate }) => {
	const parsed = await parseBody(req, shopRegionSchema)
	if (parsed.error) return parsed.error
	const { data } = parsed

	const existing = await db.orm.public.ShopRegion.whereUnique({ id: data.id }).select("id").first()
	if (existing) return fail("CONFLICT", "A region with that id already exists")

	const region = await db.orm.public.ShopRegion.create({ ...data })

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
