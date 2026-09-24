import { fail, ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { normalizeEmail, recordSignup } from "@/lib/site/signups"

export const dynamic = "force-dynamic"

/**
 * The signed-in participant's referral link: the landing page with their
 * referral code on it, which the landing's sign-up form reads back as `ref`.
 *
 * Codes live on the landing's signup list, keyed by email, so this asks the
 * same `recordSignup` the landing uses. That hands back the code already
 * assigned to this address — or, for someone who came straight to the
 * platform and never signed up on the landing, assigns them one now, which is
 * the only way they would ever get one.
 */
export const GET = withRoute(async (req: Request) => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  const email = normalizeEmail(gate.user.email)
  if (!email) return fail("UNPROCESSABLE", "Your account has no email to make a referral link from")

  const result = await recordSignup(email, "platform", { source: "platform" })
  if (!result.ok || !result.referralCode) {
    return fail("UNAVAILABLE", "Your referral link isn't available right now")
  }

  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, "")
  return ok({ link: `${origin}/?ref=${encodeURIComponent(result.referralCode)}` })
})
