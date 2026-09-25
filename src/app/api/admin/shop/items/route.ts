import prisma from "@/lib/prisma"
import { ok, fail, parseBody, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { shopItemSchema } from "@/lib/schemas/admin"
import { sanitize } from "@/lib/sanitize"
import { AuditAction, logAudit } from "@/lib/audit"
import { dollars } from "@/lib/money"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
  const gate = await requirePermission(Permission.MANAGE_SHOP)
  if (gate.error) return gate.error
  return ok({
    items: await prisma.shopItem.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  })
})

export const POST = withRoute(async (req: Request) => {
  const gate = await requirePermission(Permission.MANAGE_SHOP)
  if (gate.error) return gate.error

  const parsed = await parseBody(req, shopItemSchema)
  if (parsed.error) return parsed.error
  const data = parsed.data

  const existing = await prisma.shopItem.findUnique({ where: { id: data.id } })
  if (existing) return fail("CONFLICT", "An item with that id already exists")

  const item = await prisma.shopItem.create({
    data: {
      ...data,
      name: sanitize(data.name),
      description: sanitize(data.description),
      imageUrl: data.imageUrl ?? null,
      costUsd: dollars(data.costUsd ?? null),
    },
  })

  await logAudit({
    action: AuditAction.ADMIN_CREATE_SHOP_ITEM,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "ShopItem",
    targetId: item.id,
    metadata: { after: { name: item.name, priceCredits: item.priceCredits, costUsd: item.costUsd } },
  })

  return ok({ item }, { status: 201 })
})
