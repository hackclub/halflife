import { createWebhookHandler } from "@hackclub/ari"
import { NextResponse } from "next/server"
import { readBoundedText } from "@/lib/api"
import { applyAriWebhook, isAriWebhookConfigured } from "@/lib/ari"

// Signature checks need Node's Web Crypto, not the edge runtime.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Ari's review webhook.
 *
 * Deliberately unauthenticated in the app sense: Ari signs each delivery with `ARI_WEBHOOK_SECRET`, and the SDK verifies that before anything here runs. `/api/integrations` is already excluded from basic auth in proxy.ts, so a pre-launch gate does not swallow the deliveries.
 *
 * A thrown error becomes a non-2xx, which is how Ari is told to retry. An unknown-but-verified event is acknowledged instead, so a newer Ari event cannot be redelivered forever.
 */
type Handler = (request: Request) => Promise<Response>

let handler: Handler | null = null

export async function POST(request: Request): Promise<Response> {
	const secret = process.env.ARI_WEBHOOK_SECRET
	if (!isAriWebhookConfigured() || !secret)
		return NextResponse.json({ error: "Ari is not configured on this deployment" }, { status: 503 })

	handler ??= createWebhookHandler({
		async on_event(event, context) {
			await applyAriWebhook(event, context.delivery_id)
		},
		secret,
	})
	// Bounded before the SDK reads it: the handler verifies the signature over the raw bytes, so the body is pre-read under a cap and re-wrapped – the SDK never sees more than 1 MB no matter what the caller sent.
	const rawBody = await readBoundedText(request)
	if (rawBody === null) return NextResponse.json({ error: "Payload too large" }, { status: 413 })
	return handler(new Request(request.url, { body: rawBody, headers: request.headers, method: "POST" }))
}
