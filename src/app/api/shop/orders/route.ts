import type { NextRequest } from "next/server"
import { ok, parseBody, parseQuery, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import { cursorArgs, pageResult, paginationQuery } from "@/lib/pagination"
import prisma from "@/lib/prisma"
import { purchaseSchema } from "@/lib/schemas/shop"
import { purchase, shopOrderPublicSelect } from "@/lib/shop"

export const dynamic = "force-dynamic"

export const GET = withRoute(async (req: NextRequest) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const query = parseQuery(req, paginationQuery)
	if (query.error) return query.error

	const rows = await prisma.shopOrder.findMany({
		where: { userId: gate.user.id },
		orderBy: [{ placedAt: "desc" }, { id: "desc" }],
		...cursorArgs(query.data.cursor, query.data.limit),
		// The buyer's own view of the order, shared with the purchase response so
		// the two cannot drift.
		select: shopOrderPublicSelect,
	})

	return ok(pageResult(rows, query.data.limit))
})

export const POST = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const parsed = await parseBody(req, purchaseSchema)
	if (parsed.error) return parsed.error

	const order = await purchase(gate.user.id, parsed.data.shopItemId, parsed.data.quantity, parsed.data.idempotencyKey)

	await logAudit({
		action: AuditAction.USER_PLACE_ORDER,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ShopOrder",
		targetId: order.id,
		metadata: {
			shopItemId: parsed.data.shopItemId,
			quantity: order.quantity,
			totalCredits: order.totalCredits,
		},
	})

	return ok({ order }, { status: 201 })
})
