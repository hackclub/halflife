import { NextResponse } from "next/server"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { filesError, MISSING, submissionRepo } from "@/lib/review-platform/files-route"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/** The repository's commits back to the project's first hand-in, with each hand-in marked so the viewer can diff "since the last review". */
export const GET = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const found = await submissionRepo((await params).id, gate.user)
		if (found instanceof NextResponse) return found
		const first = found.ships[0]?.submitted_at
		const history = await found.files.commits(first ? new Date(first) : null)
		return history ? NextResponse.json({ ...history, ships: found.ships }) : filesError(MISSING, 404)
	},
)
