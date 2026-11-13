/**
 * The client address for rate limiting and audit rows, from the hop the ingress set.
 *
 * The first `x-forwarded-for` entry is what the caller sent – nginx and Traefik append, they do not replace – so keying on it let anyone rotate a header for a fresh bucket. Cloudflare overwrites `cf-connecting-ip`; behind a plain proxy the last XFF entry is the address the edge itself saw.
 *
 * `cf-connecting-ip` is believed only when `TRUST_CF_CONNECTING_IP=true`, which the Cloudflare-fronted deployment sets. The direct host (half-life.k.hackclub.dev) is not behind Cloudflare, so there the header is whatever the caller sent, and trusting it let one caller pick a fresh bucket per request.
 *
 * Pure, so both the marketing signup store and the audit trail can read it without pulling in either one's dependencies.
 */
export function trustsCfConnectingIp(): boolean {
	return (process.env.TRUST_CF_CONNECTING_IP ?? "false").trim().toLowerCase() === "true"
}

export function clientIp(h: { get(name: string): string | null }): string {
	const cf = trustsCfConnectingIp() ? h.get("cf-connecting-ip")?.trim() : undefined
	if (cf) return cf
	const forwarded = h.get("x-forwarded-for")
	const last = forwarded
		?.split(",")
		.map(part => part.trim())
		.findLast(Boolean)
	return last || h.get("x-real-ip")?.trim() || "unknown"
}
