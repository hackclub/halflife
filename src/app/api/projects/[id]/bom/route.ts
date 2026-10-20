import { after } from "next/server"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { bomData, bomLockReason, listBom, MAX_BOM_ITEMS } from "@/lib/bom"
import { HttpError } from "@/lib/errors"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { getSubmissionAccess, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { scheduleRepoSync } from "@/lib/repo-sync"
import { bomExtrasSchema, bomItemSchema } from "@/lib/schemas/project"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

function ownProject(userId: string, id: string) {
	return prisma.themeProject.findFirst({
		select: { bomTaxShippingUsd: true, buildStatus: true, designStatus: true, id: true },
		where: { deletedAt: null, id, userId },
	})
}

export const GET = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const project = await ownProject(gate.user.id, id)
	if (!project) return fail("NOT_FOUND", "Project not found")

	return ok({
		items: await listBom(project.id),
		locked: bomLockReason(project),
		taxShippingUsd: project.bomTaxShippingUsd ?? 0,
	})
})

/** Add a line to the end of the list. */
export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, bomItemSchema)
	if (parsed.error) return parsed.error

	const project = await ownProject(gate.user.id, id)
	if (!project) return fail("NOT_FOUND", "Project not found")

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)
	const locked = bomLockReason(project)
	if (locked) return fail("PHASE_LOCKED", locked)

	const input = parsed.data
	await prisma.$transaction(async tx => {
		// Re-read inside the transaction the write happens in: a design approval landing between the check above and the create would let a line into a list that is supposed to be final.
		const fresh = await tx.themeProject.findUnique({
			select: { buildStatus: true, designStatus: true },
			where: { id },
		})
		if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")
		const freshLock = bomLockReason(fresh)
		if (freshLock) throw new HttpError("PHASE_LOCKED", freshLock)

		const last = await tx.bomItem.aggregate({
			_count: true,
			_max: { sortOrder: true },
			where: { themeProjectId: id },
		})
		if (last._count >= MAX_BOM_ITEMS)
			throw new HttpError("VALIDATION_FAILED", `A parts list can have at most ${MAX_BOM_ITEMS} lines`)

		await tx.bomItem.create({
			data: {
				name: input.name,
				quantity: input.quantity,
				sortOrder: (last._max.sortOrder ?? -1) + 1,
				themeProjectId: id,
				unitCostUsd: input.unitCostUsd,
				...bomData(input),
			},
		})
	})

	after(() => scheduleRepoSync(id))

	return ok({ items: await listBom(id) }, { status: 201 })
})

const cents = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)
/**
 * Set the order's tax and shipping total. It is a field on the project rather than a line in the list, which is what keeps it from being removed: there is no row to delete, only an amount to set.
 */
export const PATCH = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, bomExtrasSchema)
	if (parsed.error) return parsed.error

	const project = await ownProject(gate.user.id, id)
	if (!project) return fail("NOT_FOUND", "Project not found")

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)
	const locked = bomLockReason(project)
	if (locked) return fail("PHASE_LOCKED", locked)

	const updated = await prisma.$transaction(async tx => {
		// Re-read inside the transaction the write happens in, as POST /bom does: a design approval landing between the check above and the write would change a list that is supposed to be final.
		const fresh = await tx.themeProject.findFirst({
			select: { buildStatus: true, designStatus: true },
			where: { deletedAt: null, id, userId: gate.user.id },
		})
		if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")
		const freshLock = bomLockReason(fresh)
		if (freshLock) throw new HttpError("PHASE_LOCKED", freshLock)

		const claimed = await tx.themeProject.updateMany({
			data: { bomTaxShippingUsd: cents(parsed.data.taxShippingUsd) },
			where: { deletedAt: null, id, userId: gate.user.id },
		})
		if (claimed.count !== 1) throw new HttpError("NOT_FOUND", "Project not found")

		const row = await tx.themeProject.findUnique({ select: { bomTaxShippingUsd: true }, where: { id } })
		if (!row) throw new HttpError("NOT_FOUND", "Project not found")
		return row
	})

	after(() => scheduleRepoSync(id))

	return ok({ taxShippingUsd: updated.bomTaxShippingUsd ?? 0 })
})
