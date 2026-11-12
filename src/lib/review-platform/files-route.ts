import "server-only"
import { NextResponse } from "next/server"
import { Phase } from "@/lib/enums"
import type { SessionUser } from "@/lib/guards"
import db from "@/lib/prisma8"
import { rateLimited } from "@/lib/rate-limit"
import { isConvertible, ModelConversion } from "@/lib/review-platform/model-conversion"
import { githubRepoFrom } from "@/lib/review-platform/repo"
import { RepoFiles } from "@/lib/review-platform/repo-files"
import { parseDbTimestamp } from "@/lib/time"

/**
 * What every `/api/reviews/[id]/files/*` route starts from: the submission's GitHub repository, checked the way the review screen checks it.
 *
 * The viewer reads `{ error: string }` on a failure (Fabricate's shape), not Half Life's `{ error: { code, message } }`, so these routes answer in that shape. The route's own guard has already required REVIEW_SUBMISSIONS; this adds the review screen's rule that nobody opens their own work here, and Fabricate's budget of 120 calls a minute per reviewer.
 */

export const filesError = (message: string, status: number): NextResponse =>
	NextResponse.json({ error: message }, { status })

export interface ShipMark {
	id: string
	kind: string
	reviewed_at: string | null
	status: string
	submitted_at: string
}

export async function submissionRepo(
	submissionId: string,
	user: SessionUser,
): Promise<{ files: RepoFiles; ships: ShipMark[] } | NextResponse> {
	if (rateLimited(`review-files:${user.id}`, { max: 120, windowMs: 60_000 }))
		return filesError("Too many requests, slow down.", 429)

	const submission = await db.orm.public.PhaseSubmission.whereUnique({ id: submissionId })
		.select("themeProjectId")
		.include("themeProject", proj => proj.select("deletedAt", "githubRepo", "userId"))
		.first()
	const project = submission?.themeProject
	if (!submission || !project || project.deletedAt || project.userId === user.id)
		return filesError("No such submission.", 404)

	const repo = githubRepoFrom(project.githubRepo)
	if (!repo) return filesError("This project's repository isn't on GitHub.", 404)

	const history = await db.orm.public.PhaseSubmission.where({ themeProjectId: submission.themeProjectId })
		.select("createdAt", "id", "phase", "resolvedAt", "resolvedResult")
		.orderBy(row => row.createdAt.asc())
		.all()
	const ships = history.map(row => ({
		id: row.id,
		kind: row.phase === Phase.DESIGN ? "design" : "build",
		reviewed_at: row.resolvedAt ? parseDbTimestamp(row.resolvedAt).toISOString() : null,
		status: row.resolvedResult ? row.resolvedResult.toLowerCase() : "pending",
		submitted_at: parseDbTimestamp(row.createdAt).toISOString(),
	}))

	const files = new RepoFiles(repo)
	if (!(await files.isPublic())) return filesError("Only public GitHub repositories can be opened here.", 404)
	return { files, ships }
}

export const MISSING = "Couldn't read this repository from GitHub."

/**
 * The conversion a `convert` or `converted` request names, checked the way Fabricate checks it: the file must be a convertible model in the repository as it stands, and the page must have loaded that same commit – a model converted from an older one would not be the one the reviewer is looking at.
 */
export async function conversionFor(files: RepoFiles, query: URLSearchParams): Promise<ModelConversion | NextResponse> {
	const path = query.get("path") ?? ""
	const sha = query.get("sha") ?? ""
	const snapshot = await files.snapshot()
	if (!snapshot) return filesError(MISSING, 404)
	if (!isConvertible(path) || !snapshot.files.some(file => file.path === path))
		return filesError("That file can't be converted.", 422)
	if (snapshot.sha !== sha)
		return filesError("The repository changed since this page loaded. Reload it to convert the latest version.", 409)
	return new ModelConversion(snapshot.repo, sha, path)
}
