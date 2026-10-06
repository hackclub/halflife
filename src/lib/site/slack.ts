import crypto from "node:crypto"

/**
 * Slack Web API + request verification.
 *
 * Auth is a single bot token (`SLACK_BOT_TOKEN`) with `chat:write`,
 * `channels:read`, `groups:read`, `channels:write.invites`, `channels:history`,
 * `im:write`, `users:read`, and `reactions:write` scopes — see
 * `slack-app-manifest.yml` at the repo root for the exact manifest to paste into
 * api.slack.com when creating the app, which annotates what each one is for.
 * chat.getPermalink and auth.test need none of them; posting into the private
 * tickets channel needs `chat:write` plus membership, but reading its member
 * list (isChannelMember) needs `groups:read`, since `channels:read` covers only
 * public channels.
 */

export type SlackBlock = Record<string, unknown>

/** Slack answers `missing_scope` with the scope it wanted (`needed`) and the
 * ones the token actually carries (`provided`). Folding them into the logged
 * detail turns a bare "missing_scope" into a line that names the scope to add,
 * instead of leaving it to a manual trip through the app's OAuth settings. */
function slackErrorDetail(data: { error?: string; needed?: string; provided?: string }, status: number): string {
	if (data.error === "missing_scope" && data.needed) {
		return data.provided
			? `${data.error} (needed ${data.needed}; token has ${data.provided})`
			: `${data.error} (needed ${data.needed})`
	}
	return data.error ?? String(status)
}

async function callSlackApi<T extends Record<string, unknown>>(
	method: string,
	params: Record<string, unknown>,
	/** Slack errors that are expected outcomes rather than faults. Matches are
	 * logged at `log` level so a normal path doesn't fill the error logs. */
	expectedErrors: string[] = [],
	/** Slack errors to omit from the logs entirely. Matches produce no log
	 * line at any level. */
	silentErrors: string[] = [],
): Promise<T & { ok: boolean; error?: string; needed?: string; provided?: string }> {
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

	const data = (await res.json()) as T & { ok: boolean; error?: string; needed?: string; provided?: string }
	if (!res.ok || !data.ok) {
		const detail = slackErrorDetail(data, res.status)
		// A silent error is an anticipated outcome noisy enough to omit
		// entirely (e.g. inviting someone already in the channel on every
		// join event). A matched expected error is still anticipated, but
		// worth a normal log line rather than an error.
		if (data.error && silentErrors.includes(data.error)) {
			// Intentionally unlogged.
		} else if (data.error && expectedErrors.includes(data.error)) {
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

/** Drops a reaction on a message: the pending one when a #half-life-help
 * question opens its ticket, the resolved one when any of the three buttons
 * closes it. `already_reacted` is marked expected: a ticket can be resolved
 * from the tickets channel or the help thread, so a second resolution finds
 * the bot's own reaction already in place, which is the outcome we wanted
 * rather than a fault. `invalid_name` — the custom emoji not existing in the
 * workspace — is logged by the API layer since there's no runtime fix for it;
 * see `slack-app-manifest.yml` for the `reactions:write` scope this needs. */
export async function addReaction(channel: string, timestamp: string, name: string) {
	return callSlackApi("reactions.add", { channel, timestamp, name }, ["already_reacted"])
}

/** Takes a reaction back off a message, the other half of swapping a
 * #half-life-help question from pending to resolved. `no_reaction` is marked
 * expected for the mirror of `already_reacted` above: two people can resolve
 * the same ticket from different places, or a Slack redelivery can rerun the
 * handler, and whoever gets there second finds the emoji already gone — the
 * outcome we wanted rather than a fault. Same `reactions:write` scope. */
export async function removeReaction(channel: string, timestamp: string, name: string) {
	return callSlackApi("reactions.remove", { channel, timestamp, name }, ["no_reaction"])
}

/** A bot token may delete only messages that bot posted, which is the whole
 * point here — every tickets-channel mirror is one we posted ourselves, so
 * this needs `chat:write` and nothing more. `message_not_found` is marked
 * expected: two people can resolve the same ticket from different places, and
 * whoever gets there second is told the message is already gone, which is the
 * outcome we wanted rather than a fault. */
export async function deleteMessage(channel: string, ts: string) {
	return callSlackApi("chat.delete", { channel, ts }, ["message_not_found"])
}

/** `already_in_channel` is treated as success — the caller just wants the
 * user in the channel, not a report of how they got there. It is omitted
 * from the logs entirely: the join handler fires for every member join, so
 * logging the no-op case buries real failures. Genuine invites still log, as
 * do genuine failures. */
export async function inviteToChannel(channel: string, user: string) {
	const result = await callSlackApi(
		"conversations.invite",
		{
			channel,
			users: user,
		},
		[],
		["already_in_channel"],
	)
	if (result.ok) {
		console.log(`Invited ${user} to ${channel}`)
	} else if (result.error !== "already_in_channel") {
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

	const data = (await res.json()) as T & { ok: boolean; error?: string; needed?: string; provided?: string }
	if (!res.ok || !data.ok) {
		console.error(`Slack API ${method} failed: ${slackErrorDetail(data, res.status)}`)
	}
	return data
}

const slackUserNameCache = new Map<string, string>()

/**
 * A user's display name for the daily summary's leaderboard.
 *
 * A `<@id>` mention would be simpler, but it notifies the person every single
 * day, which is a poor trade for a stats post. Falls back to the mention only
 * when the lookup fails, so the name is never the reason a summary breaks.
 * Cached for the life of the instance: the summary asks once per closer, and
 * a display name does not change mid-process.
 */
export async function getSlackUserName(userId: string): Promise<string> {
	const cached = slackUserNameCache.get(userId)
	if (cached) return cached

	try {
		const result = await callSlackApiGet<{
			user?: { real_name?: string; profile?: { display_name?: string; real_name?: string } }
		}>("users.info", { user: userId })
		const name = result.ok
			? result.user?.profile?.display_name || result.user?.profile?.real_name || result.user?.real_name || null
			: null
		if (name) {
			slackUserNameCache.set(userId, name)
			return name
		}
	} catch {
		// No token, or Slack unreachable — the mention below still reads fine.
	}

	return `<@${userId}>`
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

/** A message as `conversations.history` returns it, trimmed to the fields that
 * decide whether it opened a ticket. */
export type SlackHistoryMessage = {
	type?: string
	subtype?: string
	bot_id?: string
	user?: string
	ts?: string
	thread_ts?: string
}

/**
 * Walks a channel's whole history and hands back every message it saw.
 *
 * `conversations.history` pages newest-first; the cursor carries us further
 * back until Slack has no more or `maxPages` trips — a guard so a one-off
 * backfill cannot hammer the API forever. `exhausted` is false when that guard
 * tripped, so the caller can say the sweep was partial instead of quietly
 * undercounting.
 *
 * Throws on a Slack error rather than returning a short list: the backfill
 * that uses this is idempotent, so a `ratelimited` should fail loudly and be
 * re-run, not silently leave the table half-filled.
 */
export async function listChannelHistory(
	channel: string,
	opts: { maxPages?: number } = {},
): Promise<{ messages: SlackHistoryMessage[]; exhausted: boolean }> {
	const maxPages = opts.maxPages ?? 200
	const messages: SlackHistoryMessage[] = []
	let cursor: string | undefined
	for (let page = 0; page < maxPages; page += 1) {
		const result = await callSlackApiGet<{
			messages?: SlackHistoryMessage[]
			response_metadata?: { next_cursor?: string }
		}>("conversations.history", { channel, limit: "200", ...(cursor ? { cursor } : {}) })
		if (!result.ok) throw new Error(`conversations.history failed: ${result.error ?? "unknown error"}`)
		messages.push(...(result.messages ?? []))
		cursor = result.response_metadata?.next_cursor || undefined
		if (!cursor) return { messages, exhausted: true }
	}
	return { messages, exhausted: false }
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
