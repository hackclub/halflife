import { after } from "next/server"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { bomData, bomLockReason, listBom } from "@/lib/bom"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { getSubmissionAccess, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { scheduleRepoSync } from "@/lib/repo-sync"
import { bomItemUpdateSchema } from "@/lib/schemas/project"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string; itemId: string }> }

/**
 * The line, only if it belongs to one of the caller's projects – looked up
 * through the project so someone else's item id reads as not found.
 */
async function guard(userId: string, id: string, itemId: string) {
	const item = await prisma.bomItem.findFirst({
		where: { id: itemId, themeProjectId: id, themeProject: { userId, deletedAt: null } },
		select: { id: true, themeProject: { select: { designStatus: true, buildStatus: true } } },
	})
	if (!item) return { error: fail("NOT_FOUND", "Part not found") }

	const access = await getSubmissionAccess(userId, id)
	if (!access.open) return { error: fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE) }
	const locked = bomLockReason(item.themeProject)
	if (locked) return { error: fail("PHASE_LOCKED", locked) }
	return { item }
}

export const PATCH = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id, itemId } = await params

	const parsed = await parseBody(req, bomItemUpdateSchema)
	if (parsed.error) return parsed.error

	const g = await guard(gate.user.id, id, itemId)
	if (g.error) return g.error

	await prisma.bomItem.update({ where: { id: itemId }, data: bomData(parsed.data) })
	after(() => scheduleRepoSync(id))
	return ok({ items: await listBom(id) })
})

export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id, itemId } = await params

	const g = await guard(gate.user.id, id, itemId)
	if (g.error) return g.error

	await prisma.bomItem.delete({ where: { id: itemId } })
	after(() => scheduleRepoSync(id))
	return ok({ items: await listBom(id) })
})
