import { HttpError } from "@/lib/errors"
import { configuredOrigin } from "@/lib/origin"

/**
 * Where the platform is reachable from outside itself.
 *
 * One resolver, shared with the redirect path and the phone handoff: `NEXT_PUBLIC_APP_URL` is the deployment's own answer and wins, while `BETTER_AUTH_URL` is what a local checkout usually has set. Both are read at call time rather than module load, because the same build runs in more than one environment.
 *
 * The resolution was written out separately in three modules – the review notifications, the Ari webhook URL and the repo sync's generated files – which is three chances for one of them to point at the wrong origin. Only the failure modes differed: a notification link that goes nowhere, a webhook Ari cannot reach, or a link committed into somebody's repository.
 *
 * `ari.ts` still resolves its own two, and deliberately: both need a caller-supplied or localhost fallback for asset paths that have to render, so folding them in here would have moved the webhook URL and the theme thumbnails onto production whenever a deployment left the variable unset.
 */

/**
 * The public origin, without a trailing slash, or "" when the deployment names none.
 *
 * No fallback to the real site. There is one Half Life, and an omitted variable is the likeliest reason for a deployment not to have an origin of its own – but a staging deployment that fell back to production would put production links in a maker's journal and in a reviewer's notification, which is worse than a link that is not there at all. An empty origin is the honest answer, and every deployment that configures one gets it.
 */
export function appBaseUrl(): string {
	return configuredOrigin() ?? ""
}

/**
 * The public origin, failing rather than returning an empty string.
 *
 * For routes whose whole output is a link – a referral URL, a hand-off QR – an empty origin is not a lesser answer, it is a broken one. They fail closed with `NOT_CONFIGURED` so a deployment that names no origin says so plainly instead of handing out URLs that start at `/`.
 */
export function requireAppBaseUrl(): string {
	const base = appBaseUrl()
	if (!base) throw new HttpError("NOT_CONFIGURED", "The public app URL is not configured on this deployment")
	return base
}

/**
 * A project's page on the platform.
 *
 * The one place that knows the shape of a project URL, so a link written into an email, a repository or an audit row cannot disagree with the route the app actually serves.
 */
export function projectUrl(id: string): string {
	const base = appBaseUrl()
	return base ? `${base}/projects/${id}` : ""
}

/**
 * A hand-in's page in the review console.
 *
 * The id is the submission's, not the project's: one project has a design and a build hand-in, each reviewed on its own page, and that page is also where a dispute thread is answered.
 */
export function reviewUrl(id: string): string {
	const base = appBaseUrl()
	return base ? `${base}/review/${id}` : ""
}
