import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { withPermission } from "@/lib/guards"
import { dollars } from "@/lib/money"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { sanitize } from "@/lib/sanitize"
import { shopItemSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

export const GET = withPermission(Permission.MANAGE_SHOP, async () =>
	ok({
		items: await db.orm.public.ShopItem.orderBy([item => item.sortOrder.asc(), item => item.name.asc()]).all(),
	}),
)

export const POST = withPermission(Permission.MANAGE_SHOP, async (req: Request, { gate }) => {
	const parsed = await parseBody(req, shopItemSchema)
	if (parsed.error) return parsed.error
	const { data } = parsed

	const existing = await db.orm.public.ShopItem.whereUnique({ id: data.id }).select("id").first()
	if (existing) return fail("CONFLICT", "An item with that id already exists")

	const item = await db.orm.public.ShopItem.create({
		...data,
		costUsd: dollars(data.costUsd ?? null),
		description: sanitize(data.description),
		imageUrl: data.imageUrl ?? null,
		name: sanitize(data.name),
	})

	await logAudit({
		action: AuditAction.ADMIN_CREATE_SHOP_ITEM,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { after: { costUsd: item.costUsd, name: item.name, priceCredits: item.priceCredits } },
		targetId: item.id,
		targetType: "ShopItem",
	})

	return ok({ item }, { status: 201 })
})
