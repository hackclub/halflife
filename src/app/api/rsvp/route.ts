import { headers } from "next/headers"
import { bufferRsvp, getRsvpCount } from "@/lib/airtable/rsvp"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { sanitizeOptional } from "@/lib/sanitize"
import { rsvpSchema } from "@/lib/schemas/admin"
import { rateLimited, clientIp } from "@/lib/site/signups"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => ok({ count: await getRsvpCount() }))

export const POST = withRoute(async (req: Request) => {
  const parsed = await parseBody(req, rsvpSchema)
  if (parsed.error) return parsed.error

  const h = await headers()
  const ip = clientIp(h)

  // This is a public, unauthenticated write that lands a row in the drain
  // queue (and the public counter); the landing form's limiter applies here
  // too rather than leaving it open to a script.
  if (rateLimited(ip ?? "unknown")) {
    return fail("RATE_LIMITED", "Slow down a second, then try again.")
  }

  // Buffered in Postgres and drained to Airtable by a job. A signup must not
  // fail because a third party is rate-limiting us.
  await bufferRsvp({
    email: parsed.data.email,
    firstName: sanitizeOptional(parsed.data.firstName),
    lastName: sanitizeOptional(parsed.data.lastName),
    pronouns: sanitizeOptional(parsed.data.pronouns),
    utmSource: sanitizeOptional(parsed.data.utmSource),
    signupPage: sanitizeOptional(parsed.data.signupPage),
    referredBy: sanitizeOptional(parsed.data.referredBy),
    ip,
  })

  return ok({ ok: true }, { status: 201 })
})
