import { ok } from "@/lib/api"
import { LedgerKind, Phase } from "@/lib/enums"
import { withIntegrationRoute } from "@/lib/integration-route"
import db from "@/lib/prisma8"

/**
 * Read-only: every admin coin adjustment, with the design grant cards its maker holds, so a grant that was returned by hand
 * can be matched to any coins already added for that maker. Written to the app log as one line.
 *
 * An adjustment is not always tied to a design, so it is matched to the maker's design grants, whichever design they are on.
 */
export const POST = withIntegrationRoute(async () => {
	const adjustments = await db.orm.public.LedgerEntry.where({ kind: LedgerKind.ADMIN_ADJUSTMENT })
		.select("amount", "createdAt", "note", "themeProjectId", "userId")
		.all()
	const userIds = [...new Set(adjustments.map(entry => entry.userId))]
	const cards =
		userIds.length === 0
			? []
			: await db.orm.public.HcbGrantCard.where({ phase: Phase.DESIGN })
					.where(card => card.userId.in(userIds))
					.select("amountCents", "hcbStatus", "spentCents", "status", "themeProjectId", "userId")
					.all()

	const cardsFor = (userId: string) =>
		cards
			.filter(card => card.userId === userId)
			.map(card => ({
				amountCents: card.amountCents,
				hcbStatus: card.hcbStatus,
				spentCents: card.spentCents,
				status: card.status,
				themeProjectId: card.themeProjectId,
			}))

	const report = {
		adjustments: adjustments.map(entry => ({
			amount: entry.amount,
			cards: cardsFor(entry.userId),
			createdAt: String(entry.createdAt),
			note: entry.note,
			themeProjectId: entry.themeProjectId,
			userId: entry.userId,
		})),
	}
	const kindCounts: { [_: string]: number } = {}
	for (const entry of await db.orm.public.LedgerEntry.select("kind").all())
		kindCounts[entry.kind] = (kindCounts[entry.kind] ?? 0) + 1
	console.info(`[grant-adjustments-report] ${JSON.stringify({ ...report, kindCounts })}`)
	return ok({ adjustments: report.adjustments.length })
})
