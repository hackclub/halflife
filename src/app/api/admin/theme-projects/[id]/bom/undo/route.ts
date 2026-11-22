import { after } from "next/server"
import { fail, ok, parseBody } from "@/lib/api"
import { bomLockReason } from "@/lib/bom"
import { currentBomLines, latestBomEvent, readSyncMetadata, recordBomAudit, replaceBomLines } from "@/lib/bom-sync"
import { bomUndoBlock } from "@/lib/bom-sync-model"
import { AuditAction } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { scheduleRepoSync } from "@/lib/repo-sync"
import { bomUndoSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Put back the parts list an admin's repo sync replaced.
 *
 * The sync's `ADMIN_SYNC_BOM` row holds the list as it was before, so the undo restores that list and records an `ADMIN_UNDO_BOM_SYNC` row of its own, with both sides of the reversal. It is refused unless the sync is still the newest parts-list event and the list still holds what the sync wrote (see `bomUndoBlock`). Both checks run inside the transaction that writes, so a sync or edit landing between them cannot slip past.
 */
export const POST = withWritePermission(
	Permission.MANAGE_PROGRAM,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, bomUndoSchema)
		if (parsed.error) return parsed.error

		const exists = await db.orm.public.ThemeProject.where({ deletedAt: null, id }).select("id").first()
		if (!exists) return fail("NOT_FOUND", "Project not found")

		const restored = await db.transaction(async tx => {
			const fresh = await tx.orm.public.ThemeProject.whereUnique({ id }).select("buildStatus", "designStatus").first()
			if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")

			const latest = await latestBomEvent(tx, id)
			const current = await currentBomLines(tx, id)
			const sync = latest?.action === AuditAction.ADMIN_SYNC_BOM ? readSyncMetadata(latest.metadata) : null

			const block = bomUndoBlock({
				current,
				latest,
				lock: bomLockReason(fresh),
				requestedId: parsed.data.auditId,
				synced: sync?.after.lines ?? null,
			})
			if (block || !sync)
				throw new HttpError("CONFLICT", block ?? "That sync cannot be read back, so it cannot be undone")

			await replaceBomLines(tx, id, sync.before.lines)
			const auditId = await recordBomAudit(tx, {
				action: AuditAction.ADMIN_UNDO_BOM_SYNC,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: {
					after: { lines: sync.before.lines },
					before: { lines: current },
					undoes: parsed.data.auditId,
				},
				themeProjectId: id,
			})
			return { auditId, count: sync.before.lines.length }
		})

		after(() => scheduleRepoSync(id))

		return ok({ auditId: restored.auditId, restored: restored.count, undid: parsed.data.auditId })
	},
)
