import crypto from "node:crypto"

/**
 * Slack Web API + request verification.
 *
 * Auth is a single bot token (`SLACK_BOT_TOKEN`) with `chat:write`,
 * `channels:read`, `channels:write.invites`, `channels:history`, `im:write`,
 * and `users:read` scopes — see `slack-app-manifest.yml` at the repo root for
 * the exact manifest to paste into api.slack.com when creating the app, which
 * annotates what each one is for. chat.getPermalink and auth.test need none of
 * them, and the private tickets channel needs no extra scope beyond
 * `chat:write` and the bot being a member of it.
 */

export type SlackBlock = Record<string, unknown>

async function callSlackApi<T extends Record<string, unknown>>(
	method: string,
	params: Record<string, unknown>,
	/** Slack errors that are expected outcomes rather than faults. Matches are
	 * logged at `log` level so a normal path doesn't fill the error logs. */
	expectedErrors: string[] = [],
): Promise<T & { ok: boolean; error?: string }> {
	const token = process.env.SLACK_BOT_TOKEN
	if (!token) throw new Error("SLACK_BOT_TOKEN is not set")

	const res = await fetch(`https://slack.com/api/${method}`, {
		method: "POST",
		headers: {
			"content-type": "application/json; charset=utf-8",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(params),
		// Callers run inside `after` callbacks on the Events API path, where a
		// hung request holds the callback open until the platform kills it. Cap it
		// so a stalled call surfaces as a log line instead.
		signal: AbortSignal.timeout(10_000),
	})

	const data = (await res.json()) as T & { ok: boolean; error?: string }
	if (!res.ok || !data.ok) {
		const detail = data.error ?? res.status
		// A matched error is an anticipated outcome (e.g. inviting someone
		// already in the channel), so it reads as a normal log line rather
		// than an error.
		if (data.error && expectedErrors.includes(data.error)) {
			console.log(`Slack API ${method} failed: ${detail}`)
		} else {
			console.error(`Slack API ${method} failed: ${detail}`)
		}
	}
	return data
}

export async function postMessage(
	channel: string,
	text: string,
	opts: { blocks?: SlackBlock[]; threadTs?: string; unfurlLinks?: boolean } = {},
) {
	return callSlackApi<{ ts?: string; channel?: string }>("chat.postMessage", {
		channel,
		text,
		blocks: opts.blocks,
		thread_ts: opts.threadTs,
		// `undefined` drops out of JSON.stringify, so callers that don't care
		// get Slack's default; the ticket post passes true explicitly.
		unfurl_links: opts.unfurlLinks,
	})
}

export async function updateMessage(channel: string, ts: string, text: string, blocks?: SlackBlock[]) {
	return callSlackApi("chat.update", { channel, ts, text, blocks })
}

/** `already_in_channel` is treated as success — the caller just wants the
 * user in the channel, not a report of how they got there. Logs either way:
 * this runs inside a webhook with no UI to surface failures to, so the
 * deployment logs are the only way to tell it fired at all. `already_in_channel`
 * is marked expected so the API layer logs it at `log` level, not `error`. */
export async function inviteToChannel(channel: string, user: string) {
	const result = await callSlackApi(
		"conversations.invite",
		{
			channel,
			users: user,
		},
		["already_in_channel"],
	)
	if (result.ok || result.error === "already_in_channel") {
		console.log(`Invited ${user} to ${channel}`)
	} else {
		console.error(`Failed to invite ${user} to ${channel}: ${result.error}`)
	}
}

/** A Slack permalink, dropped into a message's text, auto-unfurls into a
 * rich preview of the original message (sender, avatar, timestamp, files,
 * formatting) — the closest the Bot API gets to the client's "Forward
 * message" action, which isn't itself exposed over the API. */
export async function getPermalink(channel: string, messageTs: string): Promise<string | null> {
	const result = await callSlackApiGet<{ permalink?: string }>("chat.getPermalink", { channel, message_ts: messageTs })
	return result.ok ? (result.permalink ?? null) : null
}

/** Slack's GET-family methods (`chat.getPermalink` among them) read their
 * arguments from the query string — POSTing them as a JSON body gets an
 * `invalid_arguments` back, since Slack sees no `channel`/`message_ts` at
 * all. Those methods go through here instead of `callSlackApi`. */
async function callSlackApiGet<T extends Record<string, unknown>>(
	method: string,
	params: Record<string, string>,
): Promise<T & { ok: boolean; error?: string }> {
	const token = process.env.SLACK_BOT_TOKEN
	if (!token) throw new Error("SLACK_BOT_TOKEN is not set")

	const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`
	const res = await fetch(url, {
		method: "GET",
		headers: { authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(10_000),
	})

	const data = (await res.json()) as T & { ok: boolean; error?: string }
	if (!res.ok || !data.ok) {
		console.error(`Slack API ${method} failed: ${data.error ?? res.status}`)
	}
	return data
}

let botUserId: string | null = null

/**
 * Whether a Slack user is in a channel the bot can see.
 *
 * The help channel is joined by every participant, so the thread's "Mark as
 * helped" button is gated on membership of the private tickets channel the
 * bot posts to. Fails closed: an unreadable member list refuses the action
 * rather than opening it to the room.
 */
export async function isChannelMember(channel: string, user: string): Promise<boolean> {
	let cursor: string | undefined
	for (let page = 0; page < 10; page += 1) {
		const result = await callSlackApiGet<{ members?: string[]; response_metadata?: { next_cursor?: string } }>(
			"conversations.members",
			{ channel, limit: "200", ...(cursor ? { cursor } : {}) },
		)
		if (!result.ok || !Array.isArray(result.members)) return false
		if (result.members.includes(user)) return true
		cursor = result.response_metadata?.next_cursor || undefined
		if (!cursor) return false
	}
	return false
}

/** Cached for the life of the instance — this never changes for a given
 * bot token, and calling auth.test on every event would be wasted latency
 * inside Slack's 3-second Events API window. */
export async function getBotUserId(): Promise<string | null> {
	if (botUserId) return botUserId
	const result = await callSlackApi<{ user_id?: string }>("auth.test", {})
	botUserId = result.user_id ?? null
	return botUserId
}

/**
 * HMAC verification per Slack's signing secret scheme: reject anything
 * older than 5 minutes (replay window) and anything whose signature doesn't
 * match, using a timing-safe comparison so the check itself can't leak
 * information via response time.
 */
export function verifySlackRequest(rawBody: string, timestamp: string | null, signature: string | null): boolean {
	const signingSecret = process.env.SLACK_SIGNING_SECRET
	if (!signingSecret || !timestamp || !signature) return false

	const age = Math.abs(Date.now() / 1000 - Number(timestamp))
	if (!Number.isFinite(age) || age > 60 * 5) return false

	const base = `v0:${timestamp}:${rawBody}`
	const expected = `v0=${crypto.createHmac("sha256", signingSecret).update(base, "utf8").digest("hex")}`

	const a = Buffer.from(expected, "utf8")
	const b = Buffer.from(signature, "utf8")
	return a.length === b.length && crypto.timingSafeEqual(a, b)
}
