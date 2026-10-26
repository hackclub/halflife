import { after } from "next/server"
import { fail, ok, parseBody } from "@/lib/api"
import { bomData, bomLockReason, listBom, MAX_BOM_ITEMS } from "@/lib/bom"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withSession, withWriteSession } from "@/lib/guards"
import { dollars } from "@/lib/money"
import db from "@/lib/prisma8"
import { getSubmissionAccess, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { scheduleRepoSync } from "@/lib/repo-sync"
import { bomExtrasSchema, bomItemSchema } from "@/lib/schemas/project"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

function ownProject(userId: string, id: string) {
	return db.orm.public.ThemeProject.where({ deletedAt: null, id, userId })
		.select("bomTaxShippingUsd", "buildStatus", "designStatus", "id")
		.first()
}

export const GET = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
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
export const POST = withWriteSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
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
	await db.transaction(async tx => {
		// Re-read inside the transaction the write happens in: a design approval landing between the check above and the create would let a line into a list that is supposed to be final.
		const fresh = await tx.orm.public.ThemeProject.whereUnique({ id }).select("buildStatus", "designStatus").first()
		if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")
		const freshLock = bomLockReason(fresh)
		if (freshLock) throw new HttpError("PHASE_LOCKED", freshLock)

		const last = await tx.orm.public.BomItem.where({ themeProjectId: id }).aggregate(a => ({
			count: a.count(),
			sortOrder: a.max("sortOrder"),
		}))
		if (last.count >= MAX_BOM_ITEMS)
			throw new HttpError("VALIDATION_FAILED", `A parts list can have at most ${MAX_BOM_ITEMS} lines`)

		await tx.orm.public.BomItem.create({
			name: input.name,
			quantity: input.quantity,
			sortOrder: (last.sortOrder ?? -1) + 1,
			themeProjectId: id,
			unitCostUsd: input.unitCostUsd,
			...bomData(input),
		})
	})

	after(() => scheduleRepoSync(id))

	return ok({ items: await listBom(id) }, { status: 201 })
})

const cents = (n: number | null) => dollars(n)
/**
 * Set the order's tax and shipping total. It is a field on the project rather than a line in the list, which is what keeps it from being removed: there is no row to delete, only an amount to set.
 */
export const PATCH = withWriteSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, bomExtrasSchema)
	if (parsed.error) return parsed.error

	const project = await ownProject(gate.user.id, id)
	if (!project) return fail("NOT_FOUND", "Project not found")

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)
	const locked = bomLockReason(project)
	if (locked) return fail("PHASE_LOCKED", locked)

	const updated = await db.transaction(async tx => {
		// Re-read inside the transaction the write happens in, as POST /bom does: a design approval landing between the check above and the write would change a list that is supposed to be final.
		const fresh = await tx.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
			.select("buildStatus", "designStatus")
			.first()
		if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")
		const freshLock = bomLockReason(fresh)
		if (freshLock) throw new HttpError("PHASE_LOCKED", freshLock)

		const claimed = await tx.orm.public.ThemeProject.where({
			deletedAt: null,
			id,
			userId: gate.user.id,
		}).updateAndCount({
			bomTaxShippingUsd: cents(parsed.data.taxShippingUsd),
		})
		if (claimed !== 1) throw new HttpError("NOT_FOUND", "Project not found")

		const row = await tx.orm.public.ThemeProject.whereUnique({ id }).select("bomTaxShippingUsd").first()
		if (!row) throw new HttpError("NOT_FOUND", "Project not found")
		return row
	})

	after(() => scheduleRepoSync(id))

	return ok({ taxShippingUsd: updated.bomTaxShippingUsd ?? 0 })
})
