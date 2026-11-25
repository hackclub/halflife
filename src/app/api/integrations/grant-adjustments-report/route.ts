import { ok } from "@/lib/api"
import { LedgerKind, Phase } from "@/lib/enums"
import { withIntegrationRoute } from "@/lib/integration-route"
import db from "@/lib/prisma8"

/**
 * Read-only: every admin coin adjustment on a design, with the design grant cards on the same design and maker, so a
 * grant that was returned by hand can be matched to any coins already added for it. Written to the app log as one line.
 */
export const POST = withIntegrationRoute(async () => {
	const adjustments = await db.orm.public.LedgerEntry.where({ kind: LedgerKind.ADMIN_ADJUSTMENT })
		.where(entry => entry.themeProjectId.isNotNull())
		.select("amount", "createdAt", "note", "themeProjectId", "userId")
		.all()
	const themeIds = [
		...new Set(adjustments.map(entry => entry.themeProjectId).filter((id): id is string => id !== null)),
	]
	const cards =
		themeIds.length === 0
			? []
			: await db.orm.public.HcbGrantCard.where({ phase: Phase.DESIGN })
					.where(card => card.themeProjectId.in(themeIds))
					.select("amountCents", "hcbStatus", "spentCents", "status", "themeProjectId", "userId")
					.all()

	const cardsFor = (themeProjectId: string | null, userId: string) =>
		cards
			.filter(card => card.themeProjectId === themeProjectId && card.userId === userId)
			.map(card => ({
				amountCents: card.amountCents,
				hcbStatus: card.hcbStatus,
				spentCents: card.spentCents,
				status: card.status,
			}))

	const report = {
		adjustments: adjustments.map(entry => ({
			amount: entry.amount,
			cards: cardsFor(entry.themeProjectId, entry.userId),
			createdAt: String(entry.createdAt),
			note: entry.note,
			themeProjectId: entry.themeProjectId,
			userId: entry.userId,
		})),
	}
	console.info(`[grant-adjustments-report] ${JSON.stringify(report)}`)
	return ok({ adjustments: report.adjustments.length })
})
