import { after } from "next/server"
import { fail, ok, parseBody } from "@/lib/api"
import { bomLockReason, listBom, MAX_BOM_ITEMS } from "@/lib/bom"
import { type ImportedBomLine, parseBomCsv, type SkippedRow } from "@/lib/bom-csv"
import { BOM_CSV_PATTERN } from "@/lib/config/repo-checks"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withSession } from "@/lib/guards"
import { round2 } from "@/lib/money"
import db from "@/lib/prisma8"
import { getSubmissionAccess, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { findRepoFilePath, readRepoFile } from "@/lib/repo-checks"
import { repoRefFromLink } from "@/lib/repo-ref"
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

interface RepoBom {
	lines: ImportedBomLine[]
	path: string
	skipped: SkippedRow[]
}

/**
 * The repo's BOM CSV, found, read and parsed – or a sentence saying why not.
 *
 * `limit` is what the import may add, so the overflow is reported as skipped by the parser rather than by the caller.
 */
async function readRepoBom(repoLink: string | null, limit: number): Promise<RepoBom | { error: string }> {
	if (!repoLink) return { error: "This project has no repo linked yet. Add one, then import." }

	if (!repoRefFromLink(repoLink))
		return {
			error:
				"Half Life can only read repos on GitHub or GitLab. This project's repo is on another service, so its parts have to be added by hand.",
		}

	const path = await findRepoFilePath(repoLink, BOM_CSV_PATTERN)
	if (!path)
		return {
			error: "No bom*.csv file was found in the repo. Export one from your design tool and push it, then try again.",
		}

	const csv = await readRepoFile(repoLink, path)
	if (csv === null)
		return {
			error: `Could not read ${path} from the repo. It may be too large, or on a service Half Life cannot read.`,
		}

	const parsed = parseBomCsv(csv, { limit })
	if (!parsed.header)
		return { error: `${path} does not look like a BOM table – no header row with part names was found.` }

	return { lines: parsed.lines, path, skipped: parsed.skipped }
}

export const POST = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
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

	return ok({
		imported: result.lines.length,
		items: await listBom(id),
		path: result.path,
		replaced: replace,
		skipped: result.skipped,
	})
})
