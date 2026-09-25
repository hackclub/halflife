import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
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
    },
  })

  await logAudit({
    action: AuditAction.ADMIN_UPDATE_SHOP_ITEM,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "ShopItem",
    targetId: id,
    metadata: {
      before: { priceCredits: before.priceCredits, stock: before.stock, active: before.active },
      after: { priceCredits: item.priceCredits, stock: item.stock, active: item.active },
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
