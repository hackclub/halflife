import "server-only"

const SLACK_API = "https://slack.com/api"

function token(): string | null {
	return process.env.SLACK_BOT_TOKEN ?? null
}

/**
 * One Slack Web API call.
 *
 * Throws on anything Slack does not answer with `ok: true` – a revoked token, the bot not being in the channel, a rate limit – so a caller wrapped in `trackSideEffect` writes a NOTIFICATION_FAILURE audit row instead of a console line nobody reads. (The Slack app's own client in `lib/site/slack` is separate: it answers webhooks, where the caller handles the failure.)
 */
async function slackCall<T>(method: string, body: Record<string, unknown>): Promise<T> {
	const bot = token()
	if (!bot) throw new Error("SLACK_BOT_TOKEN is not set")

	const res = await fetch(`${SLACK_API}/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${bot}`,
			"Content-Type": "application/json; charset=utf-8",
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10_000),
	})
	const data = (await res.json()) as { ok: boolean; error?: string }
	if (!res.ok || !data.ok) {
		throw new Error(`Slack ${method} failed: ${data.error ?? `HTTP ${res.status}`}`)
	}
	return data as T
}

export async function getSlackProfile(
	slackId: string,
): Promise<{ image: string | null; displayName: string | null } | null> {
	const bot = token()
	if (!bot) return null
	try {
		const res = await fetch(`${SLACK_API}/users.info?user=${encodeURIComponent(slackId)}`, {
			headers: { Authorization: `Bearer ${bot}` },
			signal: AbortSignal.timeout(10_000),
		})
		const data = (await res.json()) as {
			ok: boolean
			user?: { profile?: { image_512?: string; display_name?: string; real_name?: string } }
		}
		if (!data.ok || !data.user?.profile) return null
		return {
			image: data.user.profile.image_512 ?? null,
			displayName: data.user.profile.display_name || data.user.profile.real_name || null,
		}
	} catch {
		return null
	}
}

export async function postMessage(channel: string, text: string): Promise<void> {
	await slackCall("chat.postMessage", { channel, text })
}

export async function sendDM(slackId: string, text: string): Promise<void> {
	const opened = await slackCall<{ channel?: { id: string } }>("conversations.open", {
		users: slackId,
	})
	const channel = opened?.channel?.id
	if (!channel) throw new Error(`Slack conversations.open returned no channel for ${slackId}`)
	await postMessage(channel, text)
}
