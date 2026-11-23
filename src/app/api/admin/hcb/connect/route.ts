import { z } from "zod"
import { fail, ok, parseBody } from "@/lib/api"
import { withWritePermission } from "@/lib/guards"
import { readStoredRefreshToken } from "@/lib/hcb-credential"
import {
	HCB_OAUTH_COOKIE_MAX_AGE,
	HCB_OVERWRITE_COOKIE,
	HCB_STATE_COOKIE,
	HCB_VERIFIER_COOKIE,
	hcbAuthorizeUrl,
	hcbOAuthStart,
	hcbRedirectUri,
} from "@/lib/hcb-oauth"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

const bodySchema = z.object({ confirm: z.boolean().optional() }).strict()

/**
 * Begin connecting Half Life's HCB application.
 *
 * The callback used to be reachable by any `GET ?code=` from an admin's browser, which a journal image could fire.
 * Starting here instead is what makes the callback verifiable: this POST is admin-only and same-origin guarded, it
 * mints the state and PKCE verifier and keeps them in `__Host-` cookies only this host can set, and the callback
 * then refuses a code that did not come back with them.
 *
 * Replacing an existing credential is a separate, deliberate act: an admin who already has HCB connected has to
 * say so, so a code captured from some other flow cannot quietly swap out the deployment's payout identity.
 */
export const POST = withWritePermission(Permission.MANAGE_PROGRAM, async (req: Request) => {
	const parsed = await parseBody(req, bodySchema)
	if (parsed.error) return parsed.error

	if (!process.env.HCB_CLIENT_ID?.trim() || !process.env.HCB_CLIENT_SECRET?.trim())
		return fail("NOT_CONFIGURED", "Set HCB_CLIENT_ID and HCB_CLIENT_SECRET before connecting HCB.")
	if (!hcbRedirectUri())
		return fail("NOT_CONFIGURED", "Set HCB_REDIRECT_URI (or NEXT_PUBLIC_APP_URL) before connecting HCB.")

	const alreadyConnected = (await readStoredRefreshToken()) !== null
	if (alreadyConnected && parsed.data.confirm !== true) return ok({ needsConfirmation: true })

	const start = hcbOAuthStart()
	const url = hcbAuthorizeUrl(start)
	const options = {
		httpOnly: true,
		maxAge: HCB_OAUTH_COOKIE_MAX_AGE,
		path: "/",
		sameSite: "lax" as const,
		secure: true,
	}

	const res = ok({ url })
	res.cookies.set(HCB_STATE_COOKIE, start.state, options)
	res.cookies.set(HCB_VERIFIER_COOKIE, start.verifier, options)
	// Cleared rather than left unset, so an "overwrite" left over from a previous attempt cannot authorise this one.
	if (alreadyConnected) res.cookies.set(HCB_OVERWRITE_COOKIE, "1", options)
	else res.cookies.set(HCB_OVERWRITE_COOKIE, "", { ...options, maxAge: 0 })
	return res
})
