import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { readBoundedText } from "@/lib/api"
import { applyRobertWebhook, validRobertSignature } from "@/lib/telescreen"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Robert's outcome webhook (see lib/telescreen), Fabricate's `/webhooks/robert`. Signed with ROBERT_WEBHOOK_SECRET, which Robert shows once when this URL is set on the event.
 */
export async function POST(request: Request): Promise<Response> {
	if (!process.env.ROBERT_WEBHOOK_SECRET)
		return NextResponse.json({ error: "Robert is not configured on this deployment" }, { status: 503 })
	const body = await readBoundedText(request)
	if (body === null) return NextResponse.json({ error: "Payload too large" }, { status: 413 })
	if (!validRobertSignature(request.headers.get("x-robert-timestamp"), request.headers.get("x-robert-signature"), body))
		return new NextResponse(null, { status: 401 })
	try {
		await applyRobertWebhook(body)
	} catch (err) {
		// A body that is not JSON, or not the shape Robert documents, will not parse on a retry either: a 400 tells Robert to stop, where a 500 would have it resend forever.
		if (err instanceof SyntaxError || err instanceof ZodError) return new NextResponse(null, { status: 400 })
		throw err
	}
	return new NextResponse(null, { status: 204 })
}
