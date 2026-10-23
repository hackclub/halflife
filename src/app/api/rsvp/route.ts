/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import { headers } from "next/headers"
import { bufferRsvp, getRsvpCount } from "@/lib/airtable/rsvp"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { clientIp } from "@/lib/client-ip"
import { sanitizeOptional } from "@/lib/sanitize"
import { rsvpSchema } from "@/lib/schemas/admin"
import { signupRateLimited } from "@/lib/site/signups"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => ok({ count: await getRsvpCount() }))

export const POST = withRoute(async (req: Request) => {
	const h = await headers()
	const ip = clientIp(h)

	// This is a public, unauthenticated write that lands a row in the drain queue (and the public counter); the landing form's limiter applies here too rather than leaving it open to a script. Checked before the body is parsed, so an over-limit caller cannot make the server buffer a body first.
	if (signupRateLimited(ip)) return fail("RATE_LIMITED", "Slow down a second, then try again.")

	const parsed = await parseBody(req, rsvpSchema)
	if (parsed.error) return parsed.error

	// Buffered in Postgres and drained to Airtable by a job. A signup must not fail because a third party is rate-limiting us.
	await bufferRsvp({
		email: parsed.data.email,
		firstName: sanitizeOptional(parsed.data.firstName),
		ip,
		lastName: sanitizeOptional(parsed.data.lastName),
		pronouns: sanitizeOptional(parsed.data.pronouns),
		referredBy: sanitizeOptional(parsed.data.referredBy),
		signupPage: sanitizeOptional(parsed.data.signupPage),
		utmSource: sanitizeOptional(parsed.data.utmSource),
	})

	return ok({ ok: true }, { status: 201 })
})
