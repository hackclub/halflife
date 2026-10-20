import { fail, ok, withRoute } from "@/lib/api"
import { HttpError } from "@/lib/errors"
import { requireSession } from "@/lib/guards"
import { configuredOrigin } from "@/lib/origin"
import { normalizeEmail, recordSignup } from "@/lib/site/signups"

export const dynamic = "force-dynamic"

/**
 * The public origin the referral link points at.
 *
 * The configured value, and only the configured value. The request's own host is whatever the caller put in the `Host` header, so a link built from it could point the person who is sent it – and everyone they send it to – at a host of the caller's choosing. With nothing configured there is no safe origin to name, so the route fails closed rather than guessing one.
 *
 * The origin itself comes from the shared resolver (lib/origin), so the link points at the same place the project links and the redirects do.
 */
function publicOrigin(): string {
	const configured = configuredOrigin()
	if (!configured) throw new HttpError("NOT_CONFIGURED", "The public app URL is not configured on this deployment")
	return configured
}

/**
 * The signed-in participant's referral link: the landing page with their referral code on it, which the landing's sign-up form reads back as `ref`.
 *
 * Codes live on the landing's signup list, keyed by email, so this asks the same `recordSignup` the landing uses. That hands back the code already assigned to this address – or, for someone who came straight to the platform and never signed up on the landing, assigns them one now, which is the only way they would ever get one.
 *
 * A POST, not a GET. Reading it assigns a code and writes the participant's own address to the signup list, and a GET that writes is reachable from anywhere: a cross-site top-level navigation carries the session cookie, so a link on another site was enough to have the write happen without the participant asking for it. The write is now behind the same POST every other write in the app is behind.
 */
export const POST = withRoute(async () => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const email = normalizeEmail(gate.user.email)
	if (!email) return fail("UNPROCESSABLE", "Your account has no email to make a referral link from")

	// The origin is resolved before the signup is recorded: a link that cannot be built is a signup that need not be written.
	const origin = publicOrigin()

	const result = await recordSignup(email, "platform", { source: "platform", userId: gate.user.id })
	if (!result.ok || !result.referralCode) return fail("UNAVAILABLE", "Your referral link isn't available right now")

	return ok({ link: `${origin}/?ref=${encodeURIComponent(result.referralCode)}` })
})
