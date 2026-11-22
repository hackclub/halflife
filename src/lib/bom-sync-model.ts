import { z } from "zod"
import { AuditAction } from "@/lib/enums"

/**
 * A parts list as the audit log keeps it: what each line says, in order, with no ids or timestamps. Two lists are the same when their content is, which is the only question an undo asks.
 *
 * Kept out of `lib/bom-sync.ts` because that module is server-only and these rules are worth testing on their own.
 */

export const BomSnapshotLineSchema = z.object({
	link: z.string().nullable(),
	name: z.string(),
	purpose: z.string().nullable(),
	quantity: z.number(),
	unitCostUsd: z.number(),
	vendor: z.string().nullable(),
})
export type BomSnapshotLine = z.infer<typeof BomSnapshotLineSchema>

export const BomSnapshotSchema = z.object({ lines: z.array(BomSnapshotLineSchema) })

/** The metadata a `ADMIN_SYNC_BOM` row carries: the list before the sync, the list it wrote, and the file it came from. */
export const BomSyncMetadataSchema = z.object({
	after: BomSnapshotSchema,
	before: BomSnapshotSchema,
	path: z.string(),
})
export type BomSyncMetadata = z.infer<typeof BomSyncMetadataSchema>

/** The line's content, with nothing a database row adds on top of it. */
export function snapshotLine(line: BomSnapshotLine): BomSnapshotLine {
	return {
		link: line.link,
		name: line.name,
		purpose: line.purpose,
		quantity: line.quantity,
		unitCostUsd: line.unitCostUsd,
		vendor: line.vendor,
	}
}

/** Whether two lists hold the same lines in the same order. */
export function sameBom(a: readonly BomSnapshotLine[], b: readonly BomSnapshotLine[]): boolean {
	if (a.length !== b.length) return false
	return a.every((line, i) => {
		const other = b[i]
		return other !== undefined && JSON.stringify(snapshotLine(line)) === JSON.stringify(snapshotLine(other))
	})
}

/** The sync event an undo could reverse, as the audit log read it. */
export interface LatestBomEvent {
	action: AuditAction
	id: string
}

/**
 * Why a sync cannot be put back right now, or null when it can.
 *
 * Three things must hold. The list is not locked (the same rule every parts write follows). The sync is the newest parts-list event, so undoing it cannot rewind past a later sync or an earlier undo. And the list still holds exactly what the sync wrote: a maker's own edit since then is not overwritten by putting an old list back.
 */
export function bomUndoBlock(input: {
	current: readonly BomSnapshotLine[]
	latest: LatestBomEvent | null
	lock: string | null
	requestedId: string
	synced: readonly BomSnapshotLine[] | null
}): string | null {
	if (input.lock) return input.lock
	if (input.latest?.id !== input.requestedId || input.latest.action !== AuditAction.ADMIN_SYNC_BOM)
		return "Only the most recent parts list sync can be undone"
	if (!input.synced || !sameBom(input.current, input.synced))
		return "The parts list has changed since that sync, so it cannot be put back"
	return null
}
