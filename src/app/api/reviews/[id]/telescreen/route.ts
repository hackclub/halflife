import { NextResponse } from "next/server"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { subjectUrl } from "@/lib/review-platform/telescreen"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Open the maker of this submission in Telescreen.
 *
 * A redirect, so the queue never needs their Slack id (see lib/review-platform/telescreen). Held to the review screen's rules: REVIEW_SUBMISSIONS, and a 404 for your own work.
 */
export const GET = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const submission = await db.orm.public.PhaseSubmission.whereUnique({ id: (await params).id })
			.select("themeProjectId")
			.include("themeProject", proj =>
				proj.select("deletedAt", "userId").include("user", user => user.select("slackId")),
			)
			.first()
		const project = submission?.themeProject
		const slackId = project?.user?.slackId
		if (!project || project.deletedAt || project.userId === gate.user.id)
			return new NextResponse("No such submission.", { status: 404 })
		if (!slackId) return new NextResponse("This maker has no Slack account on file.", { status: 404 })
		return NextResponse.redirect(subjectUrl(slackId))
	},
)
