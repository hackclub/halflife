import { createWebhookHandler } from "@hackclub/ari"
import { NextResponse } from "next/server"
import { readBoundedText } from "@/lib/api"
import { parseAriExternalId } from "@/lib/ari-id"
import { AuditAction, logAudit } from "@/lib/audit"
import { isReviewWebhookConfigured } from "@/lib/review-platform"

// Signature checks need Node's Web Crypto, not the edge runtime.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Review's inbound webhook.
 *
 * Review signs `timestamp.delivery_id.body` with the same envelope Ari uses, so the SDK verifies it before this handler runs. In the read-only integration every event is recorded and ignored: Review must not move credit, Airtable or a maker notice while Ari owns decisions. When the live phase arrives this is where the provider-aware decision path will branch.
 */
type Handler = (request: Request) => Promise<Response>

let handler: Handler | null = null

export async function POST(request: Request): Promise<Response> {
	const secret = process.env.REVIEW_WEBHOOK_SECRET
	if (!isReviewWebhookConfigured() || !secret)
		return NextResponse.json({ error: "Review is not configured on this deployment" }, { status: 503 })

	handler ??= createWebhookHandler({
		async on_event(event, context) {
			const externalId = "external_id" in event ? event.external_id : null
			await logAudit({
				action: AuditAction.ARI_WEBHOOK_IGNORED,
				metadata: {
					deliveryId: context.delivery_id,
					event: event.event,
					...(event.event === "unknown" ? { eventName: event.event_name } : {}),
					provider: "review",
					reason: "shadow read-only integration",
				},
				targetId: externalId ? (parseAriExternalId(externalId)?.themeProjectId ?? null) : null,
				targetType: "ThemeProject",
			})
		},
		secret,
	})
	// Bounded before the SDK reads it: the handler verifies the signature over the raw bytes, so the body is pre-read under a cap and re-wrapped.
	const rawBody = await readBoundedText(request)
	if (rawBody === null) return NextResponse.json({ error: "Payload too large" }, { status: 413 })
	return handler(new Request(request.url, { body: rawBody, headers: request.headers, method: "POST" }))
}
