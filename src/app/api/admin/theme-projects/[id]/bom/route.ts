import { after } from "next/server"
import { fail, ok, parseBody } from "@/lib/api"
import { bomLockReason, listBom, MAX_BOM_ITEMS } from "@/lib/bom"
import { readRepoBom } from "@/lib/bom-import"
import {
	currentBomLines,
	latestBomEvent,
	readSyncMetadata,
	recordBomAudit,
	replaceBomLines,
	snapshotFromImport,
} from "@/lib/bom-sync"
import { bomUndoBlock } from "@/lib/bom-sync-model"
import { AuditAction, type PhaseStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withPermission, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { repoRefFromLink } from "@/lib/repo-ref"
import { scheduleRepoSync } from "@/lib/repo-sync"
import { bomRepoSyncSchema } from "@/lib/schemas/admin"
import { parseDbTimestamp } from "@/lib/time"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/** The project fields a parts-list decision reads, or null when there is no such project. */
function projectFor(id: string): Promise<{
	buildStatus: PhaseStatus
	designStatus: PhaseStatus
	githubRepo: string | null
	id: string
} | null> {
	return db.orm.public.ThemeProject.where({ deletedAt: null, id })
		.select("buildStatus", "designStatus", "githubRepo", "id")
		.first()
}

/**
 * A project's parts list as an admin sees it: whether its repo can be read, what the list holds, and whether the last sync can be put back.
 *
 * The undo is reported here rather than only refused on press, so the console can say why an undo is not on offer – a list edited since, or a later sync – instead of offering a button that cannot work.
 */
export const GET = withPermission(
	Permission.MANAGE_PROGRAM,
	async (_req: Request, { params }: Params & AuthedContext) => {
		const { id } = await params

		const project = await projectFor(id)
		if (!project) return fail("NOT_FOUND", "Project not found")

		const latest = await latestBomEvent(db, id)
		const current = await currentBomLines(db, id)
		const lock = bomLockReason(project)

		// Only a sync is offered for undo: an undo as the newest event means the list has already been put back.
		const sync = latest?.action === AuditAction.ADMIN_SYNC_BOM ? readSyncMetadata(latest.metadata) : null
		const lastSync =
			latest?.action === AuditAction.ADMIN_SYNC_BOM
				? {
						count: sync?.after.lines.length ?? null,
						createdAt: parseDbTimestamp(latest.createdAt).toISOString(),
						id: latest.id,
						path: sync?.path ?? null,
						undoBlock: bomUndoBlock({
							current,
							latest,
							lock,
							requestedId: latest.id,
							synced: sync?.after.lines ?? null,
						}),
					}
				: null

		return ok({
			count: current.length,
			githubRepo: project.githubRepo,
			lastSync,
			locked: lock,
			repoSupported: repoRefFromLink(project.githubRepo) !== null,
		})
	},
)

/**
 * Replace a project's parts list with the `bom*.csv` in its repo.
 *
 * Like the maker's import, one route with two acts. Without `apply` it reads the file and answers with what it found, so the console can show the swap before it happens. With `apply` it replaces the list and writes an `ADMIN_SYNC_BOM` row holding the list on both sides, in the same transaction, so the row exists exactly when the change does.
 *
 * Replacing is the whole point here: the repo is the source the admin is pulling from, so the list is set to it rather than added to. The phase lock applies as it does everywhere a parts list is written – a list in review, or a decided design, is not changed from under the decision.
 */
export const POST = withWritePermission(
	Permission.MANAGE_PROGRAM,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, bomRepoSyncSchema)
		if (parsed.error) return parsed.error

		const project = await projectFor(id)
		if (!project) return fail("NOT_FOUND", "Project not found")

		const lock = bomLockReason(project)
		const result = await readRepoBom(project.githubRepo, MAX_BOM_ITEMS)
		if ("error" in result) return fail("UNPROCESSABLE", result.error)

		if (!parsed.data.apply)
			return ok({
				applied: false,
				existing: (await currentBomLines(db, id)).length,
				lines: result.lines.map(snapshotFromImport),
				locked: lock,
				path: result.path,
				skipped: result.skipped,
			})

		if (lock) return fail("PHASE_LOCKED", lock)
		if (result.lines.length === 0) return fail("UNPROCESSABLE", `No parts with a name were found in ${result.path}.`)

		const lines = result.lines.map(snapshotFromImport)
		const auditId = await db.transaction(async tx => {
			// Re-read inside the transaction the write happens in, so a design decision landing between the checks above and the write cannot be overwritten.
			const fresh = await tx.orm.public.ThemeProject.whereUnique({ id }).select("buildStatus", "designStatus").first()
			if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")
			const freshLock = bomLockReason(fresh)
			if (freshLock) throw new HttpError("PHASE_LOCKED", freshLock)

			const before = await currentBomLines(tx, id)
			await replaceBomLines(tx, id, lines)
			return recordBomAudit(tx, {
				action: AuditAction.ADMIN_SYNC_BOM,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: {
					after: { lines },
					before: { lines: before },
					path: result.path,
					skipped: result.skipped.length,
				},
				themeProjectId: id,
			})
		})

		after(() => scheduleRepoSync(id))

		return ok({
			auditId,
			imported: lines.length,
			items: await listBom(id),
			path: result.path,
			skipped: result.skipped,
		})
	},
)
