import QRCode from "qrcode"
import { fail, ok, rateLimitedInMemory, withRoute } from "@/lib/api"
import { HttpError } from "@/lib/errors"
import { requireSession } from "@/lib/guards"
import { createHandoff, HANDOFF_TTL_MINUTES } from "@/lib/handoff"

export const dynamic = "force-dynamic"

/**
 * The public origin the phone will be told to open.
 *
 * The configured value, and only the configured value. Behind Orchard's ingress the request's own host is the internal one, and a QR encoding `http://10.x.x.x:3000` is a QR nobody's phone can reach – but the request's host is also whatever the caller put in the `Host` header, so falling back to it would let the caller choose where the QR sends a phone, and where the phone hands over a recording. With nothing configured there is no safe origin to name, so the route fails closed rather than guessing one.
 */
function publicOrigin(): string {
	const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL
	if (!configured) throw new HttpError("NOT_CONFIGURED", "The public app URL is not configured on this deployment")
	return configured.replace(/\/$/, "")
}

/**
 * Mint a phone-handoff code and render it as a QR.
 *
 * The QR is generated HERE, server-side, and returned as SVG. Sending the token to a third-party QR service would be handing an upload credential for this user's account to someone else's server.
 *
 * The plaintext token exists only in this response – it is stored as a hash and can never be read back.
 */
export const POST = withRoute(async () => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	// Each call inserts an UploadHandoff row, so cap how many one account can mint in a window.
	if (rateLimitedInMemory(`handoff-mint:${gate.user.id}`))
		return fail("RATE_LIMITED", "Too many handoff codes at once – wait a minute and try again")

	// The origin is resolved before the handoff is minted: minting one retires the user's other codes, and a deployment with no public URL has no use for a new one.
	const origin = publicOrigin()

	const handoff = await createHandoff(gate.user.id)
	const url = `${origin}/r/${handoff.token}`

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
