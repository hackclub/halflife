/**
 * Where a person's picture comes from.
 *
 * Hack Club's faces live in Slack, but Slack's own image URLs expire and
 * `users.info` needs a bot token, so a profile picture is read through Cachet —
 * a cache that answers a stable redirect for a Slack user id. HCA's `image` is
 * the fallback for anyone who has no Slack id on file yet.
 *
 * Deliberately pure (no server-only) so both the server queries and a renderer
 * can name it. The base is overridable for a self-hosted Cachet.
 */
const CACHET_BASE = (process.env.CACHET_BASE_URL ?? "https://cachet.dunkirk.sh").replace(/\/$/, "")

export function avatarUrl(user: { slackId?: string | null; image?: string | null } | null | undefined): string | null {
  if (!user) return null
  if (user.slackId) return `${CACHET_BASE}/users/${encodeURIComponent(user.slackId)}/r`
  return user.image ?? null
}
