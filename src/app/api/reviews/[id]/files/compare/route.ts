import { type NextRequest, NextResponse } from "next/server"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { filesError, MISSING, submissionRepo } from "@/lib/review-platform/files-route"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/** The files changed between two commits, with their patches capped at 100 KB each. */
export const GET = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (req: NextRequest, { params, gate }: Params & AuthedContext) => {
		const found = await submissionRepo((await params).id, gate.user)
		if (found instanceof NextResponse) return found
		const base = req.nextUrl.searchParams.get("base") ?? ""
		const head = req.nextUrl.searchParams.get("head") ?? ""
		const compare = await found.files.compare(base, head)
		return compare ? NextResponse.json(compare) : filesError(MISSING, 404)
	},
)
