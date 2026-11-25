import { ok } from "@/lib/api"
import { HcbGrantCardStatus, LedgerKind, Phase } from "@/lib/enums"
import { withIntegrationRoute } from "@/lib/integration-route"
import db from "@/lib/prisma8"

/** The grants cancelled before activation, by their HCB id, as the dry run listed them. */
const PRE_ACTIVATION_GRANT_IDS = [
	"16I2Z1",
	"yWIDnO",
	"j8I7yJ",
	"QgIln3",
	"ZEIyP5",
	"3OIpn6",
	"YeIJPB",
	"57Ir57",
	"8pImz9",
	"0EIBk9",
	"k5Ib03",
	"aKIbyE",
	"rnIg2b",
	"pjIWEy",
	"KbIZyd",
]

const pairKey = (themeProjectId: string | null, userId: string): string => `${themeProjectId}|${userId}`

/**
 * Read-only: every returned design grant with the admin coin adjustments on the same design and maker, and the grants cancelled before activation. Written to the app log as one line, so it can be searched.
 */
export const POST = withIntegrationRoute(async () => {
	const returned = await db.orm.public.HcbGrantCard.where({
		phase: Phase.DESIGN,
		status: HcbGrantCardStatus.RETURNED,
	})
		.select("amountCents", "hcbStatus", "returnedAt", "spentCents", "themeProjectId", "userId")
		.all()
	const adjustments = await db.orm.public.LedgerEntry.where({ kind: LedgerKind.ADMIN_ADJUSTMENT })
		.select("amount", "createdAt", "note", "themeProjectId", "userId")
		.all()
	const preActivation = await db.orm.public.HcbGrantCard.where(card =>
		card.hcbCardGrantId.in(PRE_ACTIVATION_GRANT_IDS.flatMap(id => [id, `cdg_${id}`])),
	)
		.select("amountCents", "hcbCardGrantId", "status", "themeProjectId", "userId")
		.all()

	const adjustmentsFor = new Map<string, { amount: number; note: string | null; createdAt: string }[]>()
	for (const entry of adjustments) {
		const key = pairKey(entry.themeProjectId, entry.userId)
		adjustmentsFor.set(key, [
			...(adjustmentsFor.get(key) ?? []),
			{ amount: entry.amount, createdAt: String(entry.createdAt), note: entry.note },
		])
	}

	const report = {
		preActivation: preActivation.map(card => ({
			amountCents: card.amountCents,
			grantId: card.hcbCardGrantId,
			status: card.status,
			themeProjectId: card.themeProjectId,
		})),
		returned: returned.map(card => {
			const found = adjustmentsFor.get(pairKey(card.themeProjectId, card.userId)) ?? []
			return {
				adjustments: found,
				adjustmentTotal: found.reduce((sum, entry) => sum + entry.amount, 0),
				amountCents: card.amountCents,
				hcbStatus: card.hcbStatus,
				returnedAt: card.returnedAt === null ? null : String(card.returnedAt),
				spentCents: card.spentCents,
				themeProjectId: card.themeProjectId,
				userId: card.userId,
			}
		}),
	}
	console.info(`[grant-adjustments-report] ${JSON.stringify(report)}`)
	return ok({ preActivation: report.preActivation.length, returned: report.returned.length })
})
