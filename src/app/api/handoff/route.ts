import QRCode from "qrcode"
import { fail, ok, rateLimitedInMemory } from "@/lib/api"
import { requireAppBaseUrl } from "@/lib/app-url"
import { withSession } from "@/lib/guards"
import { createHandoff, HANDOFF_TTL_MINUTES } from "@/lib/handoff"

export const dynamic = "force-dynamic"

/**
 * Mint a phone-handoff code and render it as a QR.
 *
 * The QR is generated HERE, server-side, and returned as SVG. Sending the token to a third-party QR service would be handing an upload credential for this user's account to someone else's server.
 *
 * The plaintext token exists only in this response – it is stored as a hash and can never be read back.
 */
export const POST = withSession(async (_req: Request, { gate }) => {
	// Each call inserts an UploadHandoff row, so cap how many one account can mint in a window.
	if (rateLimitedInMemory(`handoff-mint:${gate.user.id}`))
		return fail("RATE_LIMITED", "Too many handoff codes at once – wait a minute and try again")

	// The origin is resolved before the handoff is minted: minting one retires the user's other codes, and a deployment with no public URL has no use for a new one.
	const origin = requireAppBaseUrl()

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
