import { ShopOrderStatus } from "@/app/generated/prisma/enums"
import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { sanitize } from "@/lib/sanitize"
import { orderDecisionSchema } from "@/lib/schemas/admin"
import { fulfillOrder, getStaffOrder, rejectOrder } from "@/lib/shop"
import { formatDbTimestamp } from "@/lib/time"

interface Params {
	params: Promise<{ id: string }>
}

export const POST = withPermission(
	Permission.FULFILL_ORDERS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, orderDecisionSchema)
		if (parsed.error) return parsed.error
		const body = parsed.data

		const before = await db.orm.public.ShopOrder.whereUnique({ id }).select("status").first()
		if (!before) return fail("NOT_FOUND", "Order not found")

		if (body.action === "FULFILL") {
			const order = await fulfillOrder(id, gate.user.id, {
				carrier: body.trackingCarrier ? sanitize(body.trackingCarrier) : null,
				number: body.trackingNumber ? sanitize(body.trackingNumber) : null,
			})
			await logAudit({
				action: AuditAction.ADMIN_FULFILL_ORDER,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: { after: { status: order.status }, before: { status: before.status } },
				targetId: id,
				targetType: "ShopOrder",
			})
			return ok({ order: await getStaffOrder(id) })
		}

		if (body.action === "REJECT") {
			// The refund is a new positive ledger row, never an edit to the debit.
			const order = await rejectOrder(id, gate.user.id, sanitize(body.reason))
			await logAudit({
				action: AuditAction.ADMIN_REJECT_ORDER,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: {
					after: { status: order.status },
					before: { status: before.status },
					reason: body.reason,
					refunded: order.totalCredits,
				},
				targetId: id,
				targetType: "ShopOrder",
			})
			return ok({ order: await getStaffOrder(id) })
		}

		if (before.status !== ShopOrderStatus.PENDING) return fail("CONFLICT", "Only a pending order can be put on hold")
		// Conditional on the status just read: a concurrent fulfil or reject landing between the read and the write must not be overwritten back to ON_HOLD.
		const held = await db.orm.public.ShopOrder.where({ id, status: ShopOrderStatus.PENDING }).updateAndCount({
			heldAt: formatDbTimestamp(new Date()),
			holdReason: sanitize(body.reason),
			lastActorId: gate.user.id,
			status: ShopOrderStatus.ON_HOLD,
		})
		if (held !== 1) return fail("CONFLICT", "This order was decided by someone else")
		return ok({ order: await getStaffOrder(id) })
	},
)
