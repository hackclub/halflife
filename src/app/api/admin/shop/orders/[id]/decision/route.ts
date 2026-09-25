import { ShopOrderStatus } from "@/app/generated/prisma/enums"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { sanitize } from "@/lib/sanitize"
import { orderDecisionSchema } from "@/lib/schemas/admin"
import { fulfillOrder, rejectOrder } from "@/lib/shop"

type Params = { params: Promise<{ id: string }> }

export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.FULFILL_ORDERS)
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, orderDecisionSchema)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const before = await prisma.shopOrder.findUnique({ where: { id } })
  if (!before) return fail("NOT_FOUND", "Order not found")

  if (body.action === "FULFILL") {
    const order = await fulfillOrder(id, gate.user.id, {
      number: body.trackingNumber ? sanitize(body.trackingNumber) : null,
      carrier: body.trackingCarrier ? sanitize(body.trackingCarrier) : null,
    })
    await logAudit({
      action: AuditAction.ADMIN_FULFILL_ORDER,
      actorId: gate.user.id,
      actorEmail: gate.user.email,
      targetType: "ShopOrder",
      targetId: id,
      metadata: { before: { status: before.status }, after: { status: order.status } },
    })
    return ok({ order })
  }

  if (body.action === "REJECT") {
    // The refund is a new positive ledger row, never an edit to the debit.
    const order = await rejectOrder(id, gate.user.id, sanitize(body.reason))
    await logAudit({
      action: AuditAction.ADMIN_REJECT_ORDER,
      actorId: gate.user.id,
      actorEmail: gate.user.email,
      targetType: "ShopOrder",
      targetId: id,
      metadata: {
        reason: body.reason,
        refunded: order.totalCredits,
        before: { status: before.status },
        after: { status: order.status },
      },
    })
    return ok({ order })
  }

  if (before.status !== ShopOrderStatus.PENDING) {
    return fail("CONFLICT", "Only a pending order can be put on hold")
  }
  const order = await prisma.shopOrder.update({
    where: { id },
    data: {
      status: ShopOrderStatus.ON_HOLD,
      holdReason: sanitize(body.reason),
      heldAt: new Date(),
      lastActorId: gate.user.id,
    },
  })
  return ok({ order })
})
