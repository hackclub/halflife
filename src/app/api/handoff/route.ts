import QRCode from "qrcode"
import { fail, ok, rateLimitedInMemory, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { createHandoff, HANDOFF_TTL_MINUTES } from "@/lib/handoff"

export const dynamic = "force-dynamic"

/**
 * The public origin the phone will be told to open.
 *
 * Configured value first: behind Orchard's ingress the request's own host is the internal one, and a QR encoding `http://10.x.x.x:3000` is a QR nobody's phone can reach. The request origin is only a last resort for local dev.
 */
function publicOrigin(req: Request): string {
	const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL
	if (configured) return configured.replace(/\/$/, "")
	return new URL(req.url).origin
}

/**
 * Mint a phone-handoff code and render it as a QR.
 *
 * The QR is generated HERE, server-side, and returned as SVG. Sending the token to a third-party QR service would be handing an upload credential for this user's account to someone else's server.
 *
 * The plaintext token exists only in this response – it is stored as a hash and can never be read back.
 */
export const POST = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	// Each call inserts an UploadHandoff row, so cap how many one account can mint in a window.
	if (rateLimitedInMemory(`handoff-mint:${gate.user.id}`))
		return fail("RATE_LIMITED", "Too many handoff codes at once – wait a minute and try again")

	const handoff = await createHandoff(gate.user.id)
	const url = `${publicOrigin(req)}/r/${handoff.token}`

	const qrSvg = await QRCode.toString(url, {
		errorCorrectionLevel: "M",
		margin: 1,
		type: "svg",
		width: 200,
	})

	return ok(
		{
			expiresAt: handoff.expiresAt,
			id: handoff.id,
			qrSvg,
			ttlMinutes: HANDOFF_TTL_MINUTES,
			url,
		},
		{ status: 201 },
	)
})
