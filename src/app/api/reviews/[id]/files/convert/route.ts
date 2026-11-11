import { type NextRequest, NextResponse } from "next/server"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { conversionFor, filesError, submissionRepo } from "@/lib/review-platform/files-route"
import { conversionAvailable } from "@/lib/review-platform/model-conversion"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Convert a STEP/IGES/BREP file too big for the browser, or say how far along that is. The viewer calls this every two seconds until it answers `done`, then fetches `../converted`. See lib/review-platform/model-conversion.
 */
export const POST = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (req: NextRequest, { params, gate }: Params & AuthedContext) => {
		if (!(await conversionAvailable())) return filesError("Converting models on the server isn't set up here.", 503)
		const found = await submissionRepo((await params).id, gate.user)
		if (found instanceof NextResponse) return found
		const conversion = await conversionFor(found.files, req.nextUrl.searchParams)
		if (conversion instanceof NextResponse) return conversion
		return NextResponse.json(await conversion.start())
	},
)
