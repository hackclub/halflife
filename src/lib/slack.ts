import "server-only"
import { isRecord } from "@/lib/unknown"

const SLACK_API = "https://slack.com/api"

function token(): string | null {
	return process.env.SLACK_BOT_TOKEN ?? null
}

/**
 * One Slack Web API call.
 *
 * Throws on anything Slack does not answer with `ok: true` – a revoked token, the bot not being in the channel, a rate limit – so a caller wrapped in `trackSideEffect` writes a NOTIFICATION_FAILURE audit row instead of a console line nobody reads. (The Slack app's own client in `lib/site/slack` is separate: it answers webhooks, where the caller handles the failure.)
 */
async function slackCall(method: string, body: { [_: string]: unknown }): Promise<{ [_: string]: unknown }> {
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
	const data: unknown = await res.json()
	if (!res.ok || !isRecord(data) || data.ok !== true) {
		const error = isRecord(data) && typeof data.error === "string" ? data.error : `HTTP ${res.status}`
		throw new Error(`Slack ${method} failed: ${error}`)
	}

	return data
}

export async function postMessage(channel: string, text: string): Promise<void> {
	await slackCall("chat.postMessage", { channel, text })
}

export async function sendDM(slackId: string, text: string): Promise<void> {
	const opened = await slackCall("conversations.open", {
		users: slackId,
	})
	const channel = isRecord(opened.channel) && typeof opened.channel.id === "string" ? opened.channel.id : null
	if (!channel) throw new Error(`Slack conversations.open returned no channel for ${slackId}`)
	await postMessage(channel, text)
}
