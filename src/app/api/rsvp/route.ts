import { headers } from "next/headers"
import { ok, parseBody, withRoute } from "@/lib/api"
import { rsvpSchema } from "@/lib/schemas/admin"
import { bufferRsvp, getRsvpCount } from "@/lib/airtable/rsvp"
import { sanitizeOptional } from "@/lib/sanitize"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => ok({ count: await getRsvpCount() }))

export const POST = withRoute(async (req: Request) => {
  const parsed = await parseBody(req, rsvpSchema)
  if (parsed.error) return parsed.error

  const h = await headers()
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? h.get("cf-connecting-ip") ?? null

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
