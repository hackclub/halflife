/**
 * Where the platform is reachable from outside itself.
 *
 * Two env vars answer this and the order matters: `NEXT_PUBLIC_APP_URL` is the deployment's own answer and wins, while `BETTER_AUTH_URL` is what a local checkout usually has set. Both are read at call time rather than module load, because the same build runs in more than one environment.
 *
 * The resolution was written out separately in three modules – the review notifications, the Ari webhook URL and the repo sync's generated files – which is three chances for one of them to point at the wrong origin. Only the failure modes differed: a notification link that goes nowhere, a webhook Ari cannot reach, or a link committed into somebody's repository.
 *
 * `ari.ts` still resolves its own two, and deliberately: both need a caller-supplied or localhost fallback for asset paths that have to render, so folding them in here would have moved the webhook URL and the theme thumbnails onto production whenever a deployment left the variable unset.
 */

/**
 * The origin to use when the deployment names none.
 *
 * There is one Half Life, and an omitted variable is the likeliest reason for a deployment not to have an origin of its own – so the fallback is the real site rather than nothing. A URL that is absent is the worse failure: it silently drops a link out of a maker's journal or a reviewer's notification, and the reader never learns there was meant to be one.
 */
const DEFAULT_APP_ORIGIN = "https://halflife.hackclub.com"

/** The public origin, without a trailing slash. */
export function appBaseUrl(): string {
	const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL
	return base ? base.replace(/\/$/, "") : DEFAULT_APP_ORIGIN
}

/**
 * A project's page on the platform.
 *
 * The one place that knows the shape of a project URL, so a link written into an email, a repository or an audit row cannot disagree with the route the app actually serves.
 */
export function projectUrl(id: string): string {
	return `${appBaseUrl()}/projects/${id}`
}
