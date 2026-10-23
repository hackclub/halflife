/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import { after } from "next/server"
import { fail, ok, parseBody } from "@/lib/api"
import { bomData, bomLockReason, listBom } from "@/lib/bom"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { getSubmissionAccess, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { scheduleRepoSync } from "@/lib/repo-sync"
import { bomItemUpdateSchema } from "@/lib/schemas/project"

interface Params {
	params: Promise<{ id: string; itemId: string }>
}

/**
 * The line, only if it belongs to one of the caller's projects – looked up through the project so someone else's item id reads as not found.
 */
async function guard(userId: string, id: string, itemId: string) {
	const item = await prisma.bomItem.findFirst({
		select: { id: true, themeProject: { select: { buildStatus: true, designStatus: true } } },
		where: { id: itemId, themeProject: { deletedAt: null, userId }, themeProjectId: id },
	})
	if (!item) return { error: fail("NOT_FOUND", "Part not found") }

	const access = await getSubmissionAccess(userId, id)
	if (!access.open) return { error: fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE) }
	const locked = bomLockReason(item.themeProject)
	if (locked) return { error: fail("PHASE_LOCKED", locked) }
	return { item }
}

export const PATCH = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id, itemId } = await params

	const parsed = await parseBody(req, bomItemUpdateSchema)
	if (parsed.error) return parsed.error

	// A patch with no fields in it has nothing to write, and an update with nothing in it is not something the database can apply.
	if (Object.keys(parsed.data).length === 0) return fail("VALIDATION_FAILED", "Nothing to change")

	const g = await guard(gate.user.id, id, itemId)
	if (g.error) return g.error

	await prisma.$transaction(async tx => {
		// Re-read inside the transaction the write happens in, as POST /bom does: a design approval landing between the check above and the edit would change a list that is supposed to be final.
		const fresh = await tx.themeProject.findFirst({
			select: { buildStatus: true, designStatus: true },
			where: { deletedAt: null, id, userId: gate.user.id },
		})
		if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")
		const freshLock = bomLockReason(fresh)
		if (freshLock) throw new HttpError("PHASE_LOCKED", freshLock)

		// Conditional on the line still being the caller's, so a line deleted or moved in the meantime is not written.
		const changed = await tx.bomItem.updateMany({
			data: bomData(parsed.data),
			where: { id: itemId, themeProject: { deletedAt: null, userId: gate.user.id }, themeProjectId: id },
		})
		if (changed.count !== 1) throw new HttpError("NOT_FOUND", "Part not found")
	})
	after(() => scheduleRepoSync(id))
	return ok({ items: await listBom(id) })
})

export const DELETE = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id, itemId } = await params

	const g = await guard(gate.user.id, id, itemId)
	if (g.error) return g.error

	await prisma.$transaction(async tx => {
		// Re-read inside the transaction the write happens in, as POST /bom does: a design approval landing between the check above and the delete would empty a list that is supposed to be final.
		const fresh = await tx.themeProject.findFirst({
			select: { buildStatus: true, designStatus: true },
			where: { deletedAt: null, id, userId: gate.user.id },
		})
		if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")
		const freshLock = bomLockReason(fresh)
		if (freshLock) throw new HttpError("PHASE_LOCKED", freshLock)

		const removed = await tx.bomItem.deleteMany({
			where: { id: itemId, themeProject: { deletedAt: null, userId: gate.user.id }, themeProjectId: id },
		})
		if (removed.count !== 1) throw new HttpError("NOT_FOUND", "Part not found")
	})
	after(() => scheduleRepoSync(id))
	return ok({ items: await listBom(id) })
})

export const dynamic = "force-dynamic"
