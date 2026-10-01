import { createWebhookHandler } from "@hackclub/ari"
import { NextResponse } from "next/server"
import { applyAriWebhook, isAriWebhookConfigured } from "@/lib/ari"

// Signature checks need Node's Web Crypto, not the edge runtime.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Ari's review webhook.
 *
 * Deliberately unauthenticated in the app sense: Ari signs each delivery with
 * `ARI_WEBHOOK_SECRET`, and the SDK verifies that before anything here runs.
 * `/api/integrations` is already excluded from basic auth in proxy.ts, so a
 * pre-launch gate does not swallow the deliveries.
 *
 * A thrown error becomes a non-2xx, which is how Ari is told to retry. An
 * unknown-but-verified event is acknowledged instead, so a newer Ari event
 * cannot be redelivered forever.
 */
type Handler = (request: Request) => Promise<Response>

let handler: Handler | null = null

export async function POST(request: Request) {
	if (!isAriWebhookConfigured()) {
		return NextResponse.json({ error: "Ari is not configured on this deployment" }, { status: 503 })
	}
	const secret = process.env.ARI_WEBHOOK_SECRET!
	handler ??= createWebhookHandler({
		secret,
		async on_event(event, context) {
			await applyAriWebhook(event, context.delivery_id)
		},
	})
	return handler(request)
}
