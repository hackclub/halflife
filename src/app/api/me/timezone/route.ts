import { fail, ok, parseBody } from "@/lib/api"
import { withSession } from "@/lib/guards"
import db from "@/lib/prisma8"
import { isTimeZone } from "@/lib/program"
import { timezonePreferenceSchema } from "@/lib/schemas/timezone"

export const dynamic = "force-dynamic"

/**
 * The browser's own IANA zone, stored so the admin overview can place an account by continent and country.
 *
 * The zone is the only per-user geography the platform has (see lib/regions), and nothing else in a sign-in writes it: `User.timezone` is declared `input: false` on the auth user, so a client cannot set it through better-auth, and the only other writer is the Stasis import. That is why every account made through a sign-in read as Unknown on those panels – this route is what fills it, from the one party that knows the answer.
 *
 * Refused unless the runtime knows the zone: a value that is not a real IANA name would land in the panels as `other` or a mislabelled country, and `isTimeZone` is the same check the calendar and the feed already trust.
 */
export const PUT = withSession(async (req: Request, { gate }) => {
	const parsed = await parseBody(req, timezonePreferenceSchema)
	if (parsed.error) return parsed.error
	const { timezone } = parsed.data
	if (!isTimeZone(timezone)) return fail("VALIDATION_FAILED", "That is not a timezone this server knows")

	await db.orm.public.User.where({ id: gate.user.id }).update({ timezone })

	return ok({ timezone })
})
