import "server-only"
import { requestInfo } from "@/lib/audit"
import type { ImportedBomLine } from "@/lib/bom-csv"
import { type BomSnapshotLine, type BomSyncMetadata, BomSyncMetadataSchema, snapshotLine } from "@/lib/bom-sync-model"
import { AuditAction } from "@/lib/enums"
import type { JsonObject } from "@/lib/json"
import { round2 } from "@/lib/money"
import type { DbOrTx } from "@/lib/prisma8"
import { sanitize, sanitizeOptional } from "@/lib/sanitize"

/**
 * An admin's parts-list sync from the repo, and the database work its undo needs.
 *
 * The sync replaces a project's list with the one in its repo and writes an `ADMIN_SYNC_BOM` audit row holding the list on both sides of it. That row is what an undo reads back, so every helper that touches the list or the audit trail for it lives here, where the sync and the undo cannot drift apart.
 */

export type BomSyncAction = typeof AuditAction.ADMIN_SYNC_BOM | typeof AuditAction.ADMIN_UNDO_BOM_SYNC

/** The newest parts-list event for a project, as the audit log holds it. */
export interface LatestBomEvent {
	action: BomSyncAction
	createdAt: string
	id: string
	metadata: unknown
}

/**
 * The BOM sync event that most recently touched this project's parts list, or null when there has been none.
 *
 * Only the two sync actions count. A maker's own edits are not audited, so they show up as a difference from the list the sync wrote, which `bomUndoBlock` catches.
 */
export async function latestBomEvent(conn: DbOrTx, themeProjectId: string): Promise<LatestBomEvent | null> {
	const row = await conn.orm.public.AuditLog.where({ targetId: themeProjectId, targetType: "ThemeProject" })
		.where(event => event.action.in([AuditAction.ADMIN_SYNC_BOM, AuditAction.ADMIN_UNDO_BOM_SYNC]))
		.orderBy(event => event.createdAt.desc())
		.select("action", "createdAt", "id", "metadata")
		.first()
	// The query only returns the two sync actions; the guard says so to the type, which the query alone cannot.
	if (row?.action !== AuditAction.ADMIN_SYNC_BOM && row?.action !== AuditAction.ADMIN_UNDO_BOM_SYNC) return null
	return { action: row.action, createdAt: row.createdAt, id: row.id, metadata: row.metadata }
}

/** The project's parts list as it stands, in its order, with nothing a database row adds. */
export async function currentBomLines(conn: DbOrTx, themeProjectId: string): Promise<BomSnapshotLine[]> {
	const rows = await conn.orm.public.BomItem.where({ themeProjectId })
		.orderBy([item => item.sortOrder.asc(), item => item.createdAt.asc()])
		.select("link", "name", "purpose", "quantity", "unitCostUsd", "vendor")
		.all()
	return rows.map(snapshotLine)
}

/** Replace a project's whole parts list with these lines, in this order. */
export async function replaceBomLines(
	tx: DbOrTx,
	themeProjectId: string,
	lines: readonly BomSnapshotLine[],
): Promise<void> {
	await tx.orm.public.BomItem.where({ themeProjectId }).deleteAndCount()
	if (lines.length === 0) return
	await tx.orm.public.BomItem.createAll(
		lines.map((line, i) => ({ ...snapshotLine(line), sortOrder: i, themeProjectId })),
	)
}

/**
 * A line read from a repo CSV, cleaned the way the maker's own import cleans it, so a sync and an import of the same file store the same thing.
 */
export function snapshotFromImport(line: ImportedBomLine): BomSnapshotLine {
	return {
		link: line.link || null,
		name: sanitize(line.name),
		purpose: sanitizeOptional(line.purpose),
		quantity: line.quantity,
		unitCostUsd: round2(line.unitCostUsd),
		vendor: sanitizeOptional(line.vendor),
	}
}

/** The sync's audit payload, read back from a stored row, or null when the row does not have the shape a sync wrote. */
export function readSyncMetadata(metadata: unknown): BomSyncMetadata | null {
	const parsed = BomSyncMetadataSchema.safeParse(metadata)
	return parsed.success ? parsed.data : null
}

/**
 * Write one BOM audit row inside the transaction that changed the list, so the row exists exactly when the change does. An undo depends on that: a sync with no row cannot be put back.
 *
 * Returns the new row's id, which the response hands back so the console can offer the undo for it.
 */
export async function recordBomAudit(
	tx: DbOrTx,
	input: {
		action: BomSyncAction
		actorEmail: string
		actorId: string
		metadata: JsonObject
		themeProjectId: string
	},
): Promise<string> {
	const info = await requestInfo()
	const row = await tx.orm.public.AuditLog.create({
		action: input.action,
		actorEmail: input.actorEmail,
		actorId: input.actorId,
		actorIp: info.ip,
		actorUserAgent: info.userAgent,
		metadata: input.metadata,
		targetId: input.themeProjectId,
		targetType: "ThemeProject",
	})
	return row.id
}
