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
async function slackCall<T>(method: string, body: { [_: string]: unknown }): Promise<T> {
	const bot = token()
	if (!bot) throw new Error("SLACK_BOT_TOKEN is not set")

	const res = await fetch(`${SLACK_API}/${method}`, {
		body: JSON.stringify(body),
		headers: {
			Authorization: `Bearer ${bot}`,
			"Content-Type": "application/json; charset=utf-8",
		},
		method: "POST",
		signal: AbortSignal.timeout(10_000),
	})
	const data = (await res.json()) as { ok: boolean; error?: string }
	if (!res.ok || !data.ok) throw new Error(`Slack ${method} failed: ${data.error ?? `HTTP ${res.status}`}`)

	return data as T
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
