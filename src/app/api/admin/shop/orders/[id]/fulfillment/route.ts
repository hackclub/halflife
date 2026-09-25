import { ShopFulfillmentStage, ShopOrderStatus } from "@/app/generated/prisma/enums"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { FULFILLMENT_ORDER_STATUSES, fulfillmentStageOf } from "@/lib/queries/admin"
import { orderFulfillmentSchema } from "@/lib/schemas/admin"

type Params = { params: Promise<{ id: string }> }

/**
 * Mark how an order ships and how far it has got. Bookkeeping only: it moves
 * no coins and does not touch the order's approve/reject status.
 */
export const PATCH = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.FULFILL_ORDERS)
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, orderFulfillmentSchema)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const before = await prisma.shopOrder.findUnique({
    where: { id },
    select: { status: true, fulfillmentMethod: true, fulfillmentStage: true },
  })
  if (!before) return fail("NOT_FOUND", "Order not found")
  if (!FULFILLMENT_ORDER_STATUSES.includes(before.status)) {
    return fail("CONFLICT", "This order was rejected")
  }
  // The method can still be recorded — it may have gone out before the
  // cancellation — but the stage cannot pretend it is still shipping.
  if (
    before.status === ShopOrderStatus.CANCELLED &&
    body.stage !== undefined &&
    body.stage !== ShopFulfillmentStage.CANCELLED
  ) {
    return fail("CONFLICT", "The participant cancelled this order")
  }

  const order = await prisma.shopOrder.update({
    where: { id },
    data: {
      ...(body.method !== undefined ? { fulfillmentMethod: body.method } : {}),
      ...(body.stage !== undefined ? { fulfillmentStage: body.stage } : {}),
      fulfillmentUpdatedAt: new Date(),
      lastActorId: gate.user.id,
    },
    select: { id: true, status: true, fulfillmentMethod: true, fulfillmentStage: true },
  })

  await logAudit({
    action: AuditAction.ADMIN_UPDATE_ORDER_FULFILLMENT,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "ShopOrder",
    targetId: id,
    metadata: {
      before: { method: before.fulfillmentMethod, stage: fulfillmentStageOf(before) },
      after: { method: order.fulfillmentMethod, stage: fulfillmentStageOf(order) },
    },
  })

  return ok({ order })
})
