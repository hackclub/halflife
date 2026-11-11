import { Readable } from "node:stream"
import { type NextRequest, NextResponse } from "next/server"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { conversionFor, filesError, submissionRepo } from "@/lib/review-platform/files-route"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/** The GLB a finished conversion produced, streamed from disk. */
export const GET = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (req: NextRequest, { params, gate }: Params & AuthedContext) => {
		const found = await submissionRepo((await params).id, gate.user)
		if (found instanceof NextResponse) return found
		const conversion = await conversionFor(found.files, req.nextUrl.searchParams)
		if (conversion instanceof NextResponse) return conversion
		const result = await conversion.open()
		if (!result) return filesError("This model hasn't been converted yet.", 404)
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node's web-stream adapter is typed against the DOM's own ReadableStream
		const body = Readable.toWeb(result.stream) as ReadableStream<Uint8Array>
		return new NextResponse(body, {
			headers: {
				"Cache-Control": "private, max-age=86400",
				"Content-Length": String(result.size),
				"Content-Type": "model/gltf-binary",
			},
		})
	},
)
