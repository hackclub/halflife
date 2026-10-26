import type { NextRequest, NextResponse } from "next/server"
import { withRoute } from "@/lib/api"
import { type ExportScope, requireExportAuth, requireIntegrationAuth } from "@/lib/integration-auth"
import { postMessage } from "@/lib/site/slack"

/**
 * The preamble every `/api/integrations` route opens with.
 *
 * Ten of them were written as the same three lines – wrap the handler, check the bearer key, return the refusal – which is only worth having in one place if it is in one place: the check is load-bearing, and a route that forgets it would silently be a public endpoint with the whole app's read access.
 */

/**
 * `withRoute` plus the integration bearer check, in one wrapper.
 *
 * `withRoute` turns a thrown `HttpError` into its response and anything else into a logged 500; this puts the key check in front of it, so a handler body can assume it is already authorised and start with its actual work.
 */
export function withIntegrationRoute<A extends [NextRequest, ...unknown[]]>(
	handler: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
	const routed = withRoute(handler)
	return (...args: A) => {
		const denied = requireIntegrationAuth(args[0])
		if (denied) return Promise.resolve(denied)
		return routed(...args)
	}
}

/**
 * The export's own wrapper, because it accepts a second, narrower key and the handler needs to know which one matched.
 *
 * Same shape as `withIntegrationRoute`: authorise first, then run the handler with a context it can trust, so the route body cannot accidentally read the request before the check.
 */
export function withExportRoute<A extends unknown[]>(
	handler: (req: NextRequest, gate: { scope: ExportScope }, ...args: A) => Promise<NextResponse>,
): (req: NextRequest, ...args: A) => Promise<NextResponse> {
	const run = withRoute(handler)
	return (req: NextRequest, ...args: A) => {
		const gate = requireExportAuth(req)
		if ("denied" in gate) return Promise.resolve(gate.denied)
		return run(req, gate, ...args)
	}
}

/**
 * Whether this request asked to preview rather than write: `?dryRun=true`.
 *
 * Every integration route honours it, and it is the single thing that makes scheduled work debuggable in production – a run can be repeated by hand and show exactly what it would have written, without writing it.
 */
export const wantsDryRun = (req: NextRequest): boolean => req.nextUrl.searchParams.get("dryRun") === "true"

/**
 * Posts to Slack, failing the run rather than the message.
 *
 * `postMessage` answers `ok: false` rather than throwing, which is the right shape for a notification a human may not be waiting on. A scheduled job is different: its step is `curl -f`, so a post that quietly did not happen would leave the run green having done nothing. Throwing is what turns it red.
 */
export async function postSlackOrThrow(channel: string, text: string): Promise<void> {
	const result = await postMessage(channel, text)
	if (!result.ok) throw new Error(`Slack chat.postMessage failed: ${result.error ?? "unknown error"}`)
}
