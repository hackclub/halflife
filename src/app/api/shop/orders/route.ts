import type { NextRequest } from "next/server"
import type { Prisma } from "@/app/generated/prisma/client"
import { ok, parseBody, parseQuery, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import { type CursorOrderOf, cursorWhere, orderByFor, pageResult, paginationQuery } from "@/lib/pagination"
import prisma from "@/lib/prisma"
import { purchaseSchema } from "@/lib/schemas/shop"
import { purchase, shopOrderPublicSelect } from "@/lib/shop"

export const dynamic = "force-dynamic"

/**
 * The orders' order: newest first, with the id as the tiebreaker.
 *
 * The cursor carries both halves of that position, so a page boundary never drops an order or hands one out twice.
 */
const ORDERS_ORDER = {
	at: (row: { placedAt: Date }) => row.placedAt,
	column: "placedAt",
	direction: "desc",
} as const satisfies CursorOrderOf<{ placedAt: Date }, Prisma.ShopOrderOrderByWithRelationInput>

export const GET = withRoute(async (req: NextRequest) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const query = parseQuery(req, paginationQuery)
	if (query.error) return query.error

	const rows = await prisma.shopOrder.findMany({
		orderBy: orderByFor(ORDERS_ORDER),
		// The buyer's own view of the order, shared with the purchase response so the two cannot drift.
		select: shopOrderPublicSelect,
		take: query.data.limit + 1,
		where: cursorWhere<Prisma.ShopOrderWhereInput>(query.data.cursor, ORDERS_ORDER, {
			userId: gate.user.id,
		}),
	})

	return ok(pageResult(rows, query.data.limit, ORDERS_ORDER))
})

export const POST = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const parsed = await parseBody(req, purchaseSchema)
	if (parsed.error) return parsed.error

	const order = await purchase(gate.user.id, parsed.data.shopItemId, parsed.data.quantity, parsed.data.idempotencyKey)

	await logAudit({
		action: AuditAction.USER_PLACE_ORDER,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: {
			quantity: order.quantity,
			shopItemId: parsed.data.shopItemId,
			totalCredits: order.totalCredits,
		},
		targetId: order.id,
		targetType: "ShopOrder",
	})

	return ok({ order }, { status: 201 })
})
