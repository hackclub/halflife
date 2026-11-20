import "server-only"
import db from "@/lib/prisma8"

/**
 * Every grant card one account holds, for the admin user page: the project grant cards from the CSV and HCB batches, and the shop cards its orders asked for.
 *
 * Read as rows rather than totals, because the question the tab answers is which card went where and what became of it.
 */

export interface UserProjectGrantCard {
	amountCents: number
	createdAt: string
	error: string | null
	id: string
	issuedAt: string | null
	phase: string
	projectId: string
	projectTitle: string
	returnedAt: string | null
	status: string
}

export interface UserShopGrantCard {
	amountCents: number
	createdAt: string
	error: string | null
	id: string
	issuedAt: string | null
	itemName: string
	orderId: string
	orderNumber: number
	status: string
}

export interface UserGrantCards {
	project: UserProjectGrantCard[]
	shop: UserShopGrantCard[]
}

export async function getUserGrantCards(userId: string): Promise<UserGrantCards> {
	const [projectCards, orders] = await Promise.all([
		db.orm.public.HcbGrantCard.where({ userId })
			.orderBy([card => card.createdAt.desc()])
			.select("amountCents", "createdAt", "error", "id", "issuedAt", "phase", "returnedAt", "status", "themeProjectId")
			.all(),
		db.orm.public.ShopOrder.where({ userId })
			.select("id", "itemNameSnapshot", "orderNumber")
			.include("grantCards", cards => cards.select("amountCents", "createdAt", "error", "id", "issuedAt", "status"))
			.all(),
	])

	const projectIds = [...new Set(projectCards.map(card => card.themeProjectId))]
	const projects =
		projectIds.length === 0
			? []
			: await db.orm.public.ThemeProject.where(row => row.id.in(projectIds))
					.select("id", "title")
					.all()
	const titles = new Map(projects.map(row => [row.id, row.title] as const))

	const projectRows = projectCards.map(card => ({
		amountCents: card.amountCents,
		createdAt: card.createdAt,
		error: card.error,
		id: card.id,
		issuedAt: card.issuedAt,
		phase: card.phase,
		projectId: card.themeProjectId,
		projectTitle: titles.get(card.themeProjectId) ?? "Untitled project",
		returnedAt: card.returnedAt,
		status: card.status,
	}))

	const shop = orders
		.flatMap(order =>
			order.grantCards.map(card => ({
				amountCents: card.amountCents,
				createdAt: card.createdAt,
				error: card.error,
				id: card.id,
				issuedAt: card.issuedAt,
				itemName: order.itemNameSnapshot,
				orderId: order.id,
				orderNumber: order.orderNumber,
				status: card.status,
			})),
		)
		.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))

	return { project: projectRows, shop }
}
