import { ok } from "@/lib/api"
import { Phase } from "@/lib/enums"
import { withIntegrationRoute } from "@/lib/integration-route"
import db from "@/lib/prisma8"

/**
 * The grants cancelled before activation, from the dry run: HCB's id and the balance HCB returned, in cents. HCB gives the
 * CSV rows no id, so these amounts are the only handle on them.
 */
const PRE_ACTIVATION: { amountCents: number; grantId: string }[] = [
	{ amountCents: 2711, grantId: "16I2Z1" },
	{ amountCents: 9407, grantId: "yWIDnO" },
	{ amountCents: 2292, grantId: "j8I7yJ" },
	{ amountCents: 2966, grantId: "QgIln3" },
	{ amountCents: 3210, grantId: "ZEIyP5" },
	{ amountCents: 3414, grantId: "3OIpn6" },
	{ amountCents: 2083, grantId: "YeIJPB" },
	{ amountCents: 3249, grantId: "57Ir57" },
	{ amountCents: 3202, grantId: "8pImz9" },
	{ amountCents: 2853, grantId: "0EIBk9" },
	{ amountCents: 2966, grantId: "k5Ib03" },
	{ amountCents: 2668, grantId: "aKIbyE" },
	{ amountCents: 2959, grantId: "rnIg2b" },
	{ amountCents: 2896, grantId: "pjIWEy" },
	{ amountCents: 3000, grantId: "KbIZyd" },
]

/**
 * Read-only: the CSV export rows whose amount matches one of the grants cancelled before activation, with the design grant
 * cards on the same project. Written to the app log as one line. No emails are written.
 */
export const POST = withIntegrationRoute(async () => {
	const amounts = [...new Set(PRE_ACTIVATION.map(grant => grant.amountCents))]
	const exportRows = await db.orm.public.HcbCardGrantExportRow.where(row => row.amountCents.in(amounts))
		.select("amountCents", "batchId", "createdAt", "supersededAt", "themeProjectId")
		.all()
	const projectIds = [...new Set(exportRows.map(row => row.themeProjectId))]
	const cards =
		projectIds.length === 0
			? []
			: await db.orm.public.HcbGrantCard.where({ phase: Phase.DESIGN })
					.where(card => card.themeProjectId.in(projectIds))
					.select("amountCents", "hcbStatus", "spentCents", "status", "themeProjectId", "userId")
					.all()

	const report = {
		candidates: PRE_ACTIVATION.map(grant => ({
			amountCents: grant.amountCents,
			exportRows: exportRows
				.filter(row => row.amountCents === grant.amountCents)
				.map(row => ({
					batchId: row.batchId,
					cards: cards
						.filter(card => card.themeProjectId === row.themeProjectId)
						.map(card => ({
							amountCents: card.amountCents,
							hcbStatus: card.hcbStatus,
							spentCents: card.spentCents,
							status: card.status,
						})),
					createdAt: String(row.createdAt),
					supersededAt: row.supersededAt === null ? null : String(row.supersededAt),
					themeProjectId: row.themeProjectId,
				})),
			grantId: grant.grantId,
		})),
	}
	console.info(`[grant-adjustments-report] ${JSON.stringify(report)}`)
	return ok({ candidates: report.candidates.length })
})
