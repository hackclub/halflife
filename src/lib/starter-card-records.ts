import "server-only"
import { AuditAction, logAuditTx } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import { grantCardFingerprint } from "@/lib/grant-card-policy"
import db, { isUniqueViolation } from "@/lib/prisma8"
import { formatDbTimestamp } from "@/lib/time"

/**
 * The starter cards the site knows about, so a future CSV wave or starter export cannot pay the same project twice.
 *
 * A card goes into `hcb_card_grant_export_row` the way a CSV export does: one batch, one row per card, in one transaction. The unique index only covers live rows, so a card cancelled on HCB is superseded here and its project can be paid again.
 */

export interface RecordedCard {
	amountCents: number
	email: string
	projectId: string
}

/** Record a batch of starter cards. A project with a live row already refuses the whole batch, so nothing is half-recorded. */
export function recordStarterCards(cards: readonly RecordedCard[]): Promise<{ batchId: string; totalCents: number }> {
	const totalCents = cards.reduce((sum, card) => sum + card.amountCents, 0)
	const fingerprint = grantCardFingerprint(
		cards.map(card => ({ amountCents: card.amountCents, email: card.email, projectId: card.projectId })),
	)
	return db.transaction(async tx => {
		if (cards.length === 0) throw new HttpError("CONFLICT", "No cards to record")
		const batch = await tx.orm.public.HcbCardGrantExportBatch.create({
			createdById: null,
			fingerprint,
			totalCents,
		})
		try {
			await tx.orm.public.HcbCardGrantExportRow.createAll(
				cards.map(card => ({
					amountCents: card.amountCents,
					batchId: batch.id,
					email: card.email,
					themeProjectId: card.projectId,
				})),
			)
		} catch (err) {
			if (isUniqueViolation(err))
				throw new HttpError("CONFLICT", "A live card is already recorded for one of these projects")
			throw err
		}
		await logAuditTx(tx, {
			action: AuditAction.ADMIN_CREATE_GRANT_CARD_EXPORT,
			actorEmail: null,
			actorId: null,
			metadata: { batchId: batch.id, cards: cards.length, source: "starter-funding-export", totalCents },
		})
		return { batchId: batch.id, totalCents }
	})
}

/** Supersede the live rows for these projects, when their HCB cards have been cancelled. Returns how many were superseded. */
export function supersedeLiveCards(projectIds: readonly string[], reason: string): Promise<number> {
	return db.transaction(async tx => {
		if (projectIds.length === 0) return 0
		const rows = await tx.orm.public.HcbCardGrantExportRow.where(row => row.supersededAt.isNull())
			.where(row => row.themeProjectId.in([...projectIds]))
			.select("amountCents", "id", "themeProjectId")
			.all()
		if (rows.length === 0) return 0
		await tx.orm.public.HcbCardGrantExportRow.where(row => row.id.in(rows.map(r => r.id))).update({
			supersededAt: formatDbTimestamp(new Date()),
		})
		await logAuditTx(tx, {
			action: AuditAction.ADMIN_SUPERSEDE_GRANT_CARD_EXPORT,
			actorEmail: null,
			actorId: null,
			metadata: {
				reason,
				rows: rows.map(r => ({ amountCents: r.amountCents, projectId: r.themeProjectId })),
			},
		})
		return rows.length
	})
}

/** The live recorded card for each project, in cents. A project with none is left out of the map. */
export async function liveRecordedCents(projectIds: readonly string[]): Promise<Map<string, number>> {
	const recorded = new Map<string, number>()
	if (projectIds.length === 0) return recorded
	const rows = await db.orm.public.HcbCardGrantExportRow.where(row => row.supersededAt.isNull())
		.where(row => row.themeProjectId.in([...projectIds]))
		.select("amountCents", "themeProjectId")
		.all()
	for (const row of rows) recorded.set(row.themeProjectId, row.amountCents)
	return recorded
}
