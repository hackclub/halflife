import { type NextRequest, NextResponse } from "next/server"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { submissionRepo } from "@/lib/review-platform/files-route"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/** A README's signed `user-attachments` image: a redirect to the URL GitHub signed for its own rendering of the file. */
export const GET = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (req: NextRequest, { params, gate }: Params & AuthedContext) => {
		const found = await submissionRepo((await params).id, gate.user)
		if (found instanceof NextResponse) return found
		const url = await found.files.attachmentUrl(
			req.nextUrl.searchParams.get("path") ?? "",
			req.nextUrl.searchParams.get("id") ?? "",
		)
		return url ? NextResponse.redirect(url) : new NextResponse(null, { status: 404 })
	},
)
