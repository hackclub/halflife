import { after } from "next/server"
import { fail, ok, parseBody } from "@/lib/api"
import { bomLockReason, listBom, MAX_BOM_ITEMS, syncBomToAirtable } from "@/lib/bom"
import { readRepoBom } from "@/lib/bom-import"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withWriteSession } from "@/lib/guards"
import { round2 } from "@/lib/money"
import db from "@/lib/prisma8"
import { getSubmissionAccess, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { scheduleRepoSync } from "@/lib/repo-sync"
import { sanitize, sanitizeOptional } from "@/lib/sanitize"
import { bomImportSchema } from "@/lib/schemas/project"

export const dynamic = "force-dynamic"

/**
 * Import a project's parts list from the `bom*.csv` already in its repo.
 *
 * A maker who exported a BOM from KiCad or EasyEDA has the parts listed once already; retyping them onto the page is busywork that invites mismatched prices. This reads that file through the same repo plumbing the pre-submission checks use – the same cached file list, the same forge-aware read – and turns whatever columns it recognises into lines.
 *
 * One route, two acts. Without `apply` it only reads and answers with what it found, which is what the preview shows; a maker can look while the list is even locked, because looking writes nothing. With `apply` it writes, and then it carries the same guards every other parts write does: submissions open, the phase not frozen, the list's cap respected.
 *
 * The CSV is re-read on apply rather than trusting what the preview returned. The preview is not a contract – the file may have moved on, and a client is free to send whatever it likes – so the bytes that are parsed are always the ones in the repo at the moment of the write.
 */

interface Params {
	params: Promise<{ id: string }>
}

export const POST = withWriteSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, bomImportSchema)
	if (parsed.error) return parsed.error
	const { apply, replace } = parsed.data

	const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
		.select("buildStatus", "designStatus", "githubRepo", "id")
		.first()
	if (!project) return fail("NOT_FOUND", "Project not found")

	const { count: existing } = await db.orm.public.BomItem.where({ themeProjectId: id }).aggregate(a => ({
		count: a.count(),
	}))
	// A replace has the whole cap to spend; an addition shares it with the lines already there.
	const limit = replace ? MAX_BOM_ITEMS : Math.max(0, MAX_BOM_ITEMS - existing)

	if (!apply) {
		const result = await readRepoBom(project.githubRepo, limit)
		if ("error" in result) return fail("UNPROCESSABLE", result.error)
		return ok({ ...result, applied: false, existing, replace })
	}

	// The write half. Same checks as POST /bom, in the same order.
	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)
	const locked = bomLockReason(project)
	if (locked) return fail("PHASE_LOCKED", locked)

	const result = await readRepoBom(project.githubRepo, limit)
	if ("error" in result) return fail("UNPROCESSABLE", result.error)
	if (result.lines.length === 0) return fail("UNPROCESSABLE", `No parts with a name were found in ${result.path}.`)

	await db.transaction(async tx => {
		// Re-read inside the transaction the write happens in, as POST /bom does: a design approval landing between the check above and the create would let lines into a list that is supposed to be final.
		const fresh = await tx.orm.public.ThemeProject.whereUnique({ id }).select("buildStatus", "designStatus").first()
		if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")
		const freshLock = bomLockReason(fresh)
		if (freshLock) throw new HttpError("PHASE_LOCKED", freshLock)

		// The count is what the cap is about, not the sort order – replacing clears the list, adding shares its room.
		const { count } = replace
			? { count: 0 }
			: await tx.orm.public.BomItem.where({ themeProjectId: id }).aggregate(a => ({ count: a.count() }))
		if (count + result.lines.length > MAX_BOM_ITEMS)
			throw new HttpError("VALIDATION_FAILED", `A parts list can have at most ${MAX_BOM_ITEMS} lines`)
		const last = replace
			? null
			: await tx.orm.public.BomItem.where({ themeProjectId: id }).aggregate(a => ({
					sortOrder: a.max("sortOrder"),
				}))
		const base = replace ? 0 : (last?.sortOrder ?? -1) + 1

		if (replace) await tx.orm.public.BomItem.where({ themeProjectId: id }).deleteAndCount()
		await tx.orm.public.BomItem.createAll(
			result.lines.map((line, i) => ({
				link: line.link || null,
				name: sanitize(line.name),
				// Deliberately not filled in when the file had no column for them: the maker edits the blanks the way the form asks for.
				purpose: sanitizeOptional(line.purpose),
				quantity: line.quantity,
				sortOrder: base + i,
				themeProjectId: id,
				unitCostUsd: round2(line.unitCostUsd),
				vendor: sanitizeOptional(line.vendor),
			})),
		)
	})

	after(() => scheduleRepoSync(id))
	after(() => syncBomToAirtable(id, gate.user))

	return ok({
		imported: result.lines.length,
		items: await listBom(id),
		path: result.path,
		replaced: replace,
		skipped: result.skipped,
	})
})
