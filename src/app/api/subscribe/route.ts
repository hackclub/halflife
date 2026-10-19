import { NextResponse } from "next/server"
import { parseBody } from "@/lib/api"
import { subscribeSchema } from "@/lib/schemas/admin"
import { clientIp, normalizeEmail, rateLimited, recordSignup } from "@/lib/site/signups"

export async function POST(request: Request): Promise<NextResponse> {
	const ip = clientIp(request.headers)

	if (rateLimited(ip))
		return NextResponse.json({ error: "Slow down a second, then try again.", ok: false }, { status: 429 })

	const parsed = await parseBody(request, subscribeSchema)
	if (parsed.error)
		// parseBody speaks the API error dialect; this route speaks plain landing-page copy. Same 400, friendlier body.
		return NextResponse.json({ error: "That doesn't look like an email address.", ok: false }, { status: 400 })

	// Lowercase + length/shape check on top of zod, so "Foo@Bar.com" and "foo@bar.com" are the same signup.
	const email = normalizeEmail(parsed.data.email)
	if (!email)
		return NextResponse.json({ error: "That doesn't look like an email address.", ok: false }, { status: 400 })

	try {
		const result = await recordSignup(email, ip, {
			ref: parsed.data.ref ?? null,
			utmCampaign: parsed.data.utmCampaign ?? null,
			utmMedium: parsed.data.utmMedium ?? null,
			utmSource: parsed.data.utmSource ?? null,
		})
		if (!result.ok) return NextResponse.json({ error: result.error, ok: false }, { status: result.status })

		// Says nothing about whether the address was already on the list, and never returns the stored referral code: this endpoint is unauthenticated, so a `duplicate` flag or a code made it an oracle for anyone's registration status. The signed-in owner gets their link from /api/me/referral, which reads the session's own email.
		return NextResponse.json({ ok: true })
	} catch {
		return NextResponse.json({ error: "Something broke on our end. Try again shortly.", ok: false }, { status: 500 })
	}
}
