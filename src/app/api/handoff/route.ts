import QRCode from "qrcode"
import { ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { createHandoff, HANDOFF_TTL_MINUTES } from "@/lib/handoff"

export const dynamic = "force-dynamic"

/**
 * The public origin the phone will be told to open.
 *
 * Configured value first: behind Orchard's ingress the request's own host is
 * the internal one, and a QR encoding `http://10.x.x.x:3000` is a QR nobody's
 * phone can reach. The request origin is only a last resort for local dev.
 */
function publicOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL
  if (configured) return configured.replace(/\/$/, "")
  return new URL(req.url).origin
}

/**
 * Mint a phone-handoff code and render it as a QR.
 *
 * The QR is generated HERE, server-side, and returned as SVG. Sending the
 * token to a third-party QR service would be handing an upload credential for
 * this user's account to someone else's server.
 *
 * The plaintext token exists only in this response — it is stored as a hash
 * and can never be read back.
 */
export const POST = withRoute(async (req: Request) => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  const handoff = await createHandoff(gate.user.id)
  const url = `${publicOrigin(req)}/r/${handoff.token}`

  const qrSvg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 200,
  })

  return ok(
    {
      id: handoff.id,
      qrSvg,
      url,
      expiresAt: handoff.expiresAt,
      ttlMinutes: HANDOFF_TTL_MINUTES,
    },
    { status: 201 },
  )
})
