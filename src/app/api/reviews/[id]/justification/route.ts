import { readJustificationRow } from "@/lib/airtable/sync"
import { fail, ok } from "@/lib/api"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * The submission's Airtable row as an approval would find it, so the decision panel can preview `Automation - Unified Justification` (see lib/airtable/unified-justification).
 *
 * A read, not a decision: one Airtable request per open decision panel. Held to the review screen's rules: REVIEW_SUBMISSIONS, and a 404 for your own work.
 */
export const GET = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const submission = await db.orm.public.PhaseSubmission.whereUnique({ id: (await params).id })
			.select("phase", "themeProjectId")
			.include("themeProject", project => project.select("deletedAt", "userId"))
			.first()
		const project = submission?.themeProject
		if (!submission || !project || project.deletedAt || project.userId === gate.user.id)
			return fail("NOT_FOUND", "No such submission")
		return ok(await readJustificationRow(submission.themeProjectId, submission.phase))
	},
)
