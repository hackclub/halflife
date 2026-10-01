import { NextResponse } from "next/server"
import { clientIp, normalizeEmail, rateLimited, recordSignup } from "@/lib/site/signups"

/** Referral codes and UTM values are freeform, untrusted client input — cap
 * length and drop anything that isn't a string rather than validate a shape. */
function sanitizeParam(raw: unknown): string | null {
	if (typeof raw !== "string") return null
	const value = raw.trim().slice(0, 128)
	return value.length > 0 ? value : null
}

export async function POST(request: Request) {
	const ip = clientIp(request.headers)

	if (rateLimited(ip)) {
		return NextResponse.json({ ok: false, error: "Slow down a second, then try again." }, { status: 429 })
	}

	let body: unknown
	try {
		body = await request.json()
	} catch {
		return NextResponse.json({ ok: false, error: "We couldn't read that request." }, { status: 400 })
	}

	const fields = typeof body === "object" && body !== null ? body : {}
	const email = normalizeEmail((fields as { email?: unknown }).email)

	if (!email) {
		return NextResponse.json({ ok: false, error: "That doesn't look like an email address." }, { status: 400 })
	}

	const ref = sanitizeParam((fields as { ref?: unknown }).ref)
	const utmSource = sanitizeParam((fields as { utmSource?: unknown }).utmSource)
	const utmMedium = sanitizeParam((fields as { utmMedium?: unknown }).utmMedium)
	const utmCampaign = sanitizeParam((fields as { utmCampaign?: unknown }).utmCampaign)

	try {
		const result = await recordSignup(email, ip, {
			ref,
			utmSource,
			utmMedium,
			utmCampaign,
		})
		if (!result.ok) {
			return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
		}
		// Says nothing about whether the address was already on the list, and
		// never returns the stored referral code: this endpoint is unauthenticated,
		// so a `duplicate` flag or a code made it an oracle for anyone's
		// registration status. The signed-in owner gets their link from
		// /api/me/referral, which reads the session's own email.
		return NextResponse.json({ ok: true })
	} catch {
		return NextResponse.json({ ok: false, error: "Something broke on our end. Try again shortly." }, { status: 500 })
	}
}
