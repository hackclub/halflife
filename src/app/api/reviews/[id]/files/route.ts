import { NextResponse } from "next/server"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { filesError, MISSING, submissionRepo } from "@/lib/review-platform/files-route"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/** The repository's file list at its default branch's head, for the review file viewer. */
export const GET = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const found = await submissionRepo((await params).id, gate.user)
		if (found instanceof NextResponse) return found
		const snapshot = await found.files.snapshot()
		return snapshot ? NextResponse.json(snapshot) : filesError(MISSING, 404)
	},
)
