import { NextResponse } from "next/server"
import { experienceCheck } from "@/lib/experience-check"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * The experience check for this submission's maker (see lib/experience-check), which the review screen asks for once it has loaded.
 *
 * Held to the review screen's rules: REVIEW_SUBMISSIONS, and a 404 for your own work.
 */
export const GET = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const submission = await db.orm.public.PhaseSubmission.whereUnique({ id: (await params).id })
			.select("themeProjectId")
			.include("themeProject", proj => proj.select("deletedAt", "id", "userId"))
			.first()
		const project = submission?.themeProject
		if (!project || project.deletedAt || project.userId === gate.user.id)
			return new NextResponse("No such submission.", { status: 404 })
		return NextResponse.json(await experienceCheck(project.userId, project.id))
	},
)
