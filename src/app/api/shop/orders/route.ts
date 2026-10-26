import type { NextRequest } from "next/server"
import { ok, parseBody, parseQuery } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { withSession, withWriteSession } from "@/lib/guards"
import { decodeCursor, encodeCursor, paginationQuery } from "@/lib/pagination"
import db from "@/lib/prisma8"
import { purchaseSchema } from "@/lib/schemas/shop"
import { purchase, shopOrderPublicFields, toShopOrderPublic } from "@/lib/shop"
import { formatDbTimestamp } from "@/lib/time"

export const dynamic = "force-dynamic"

export const GET = withSession(async (req: NextRequest, { gate }) => {
	const query = parseQuery(req, paginationQuery)
	if (query.error) return query.error

	// Newest first, with the id as the tiebreaker, so a page boundary never drops an order or hands one out twice.
	const filtered = db.orm.public.ShopOrder.where({ userId: gate.user.id }).orderBy([
		order => order.placedAt.desc(),
		order => order.id.desc(),
	])
	// Only the API reads this list, so a cursor that is not one of ours is a bad request rather than a page to fall back to.
	const position = query.data.cursor === undefined ? null : decodeCursor(query.data.cursor)
	const rows = await (position?.at
		? filtered.cursor({ id: position.id, placedAt: formatDbTimestamp(position.at) })
		: filtered
	)
		.limit(query.data.limit + 1)
		// The buyer's own view of the order, shared with the purchase response so the two cannot drift.
		.select(...shopOrderPublicFields)
		.all()
	const items = rows.slice(0, query.data.limit).map(toShopOrderPublic)
	const last = items.at(-1)
	return ok({
		items,
		nextCursor: rows.length > query.data.limit && last ? encodeCursor({ at: last.placedAt, id: last.id }) : null,
	})
})

export const POST = withWriteSession(async (req: Request, { gate }) => {
	const parsed = await parseBody(req, purchaseSchema)
	if (parsed.error) return parsed.error

	const order = await purchase(
		gate.user.id,
		parsed.data.shopItemId,
		parsed.data.quantity,
		parsed.data.idempotencyKey,
		parsed.data.note ?? null,
	)

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
