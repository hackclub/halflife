import crypto from "node:crypto"
import { z } from "zod"
import { readBoundedText } from "@/lib/api"

/**
 * Slack Web API + request verification.
 *
 * Auth is a single bot token (`SLACK_BOT_TOKEN`) with `chat:write`, `channels:read`, `groups:read`, `channels:write.invites`, `channels:history`, `im:write`, `users:read`, and `reactions:write` scopes – see `slack-app-manifest.yml` at the repo root for the exact manifest to paste into api.slack.com when creating the app, which annotates what each one is for. chat.getPermalink and auth.test need none of them; posting into the private tickets channel needs `chat:write` plus membership, but reading its member list (isChannelMember) needs `groups:read`, since `channels:read` covers only public channels.
 */

export interface SlackBlock {
	[_: string]: unknown
}

/** Slack answers `missing_scope` with the scope it wanted (`needed`) and the ones the token actually carries (`provided`). Folding them into the logged detail turns a bare "missing_scope" into a line that names the scope to add,
 *
 * * instead of leaving it to a manual trip through the app's OAuth settings.
 */
function slackErrorDetail(data: { error?: string; needed?: string; provided?: string }, status: number): string {
	if (data.error === "missing_scope" && data.needed)
		return data.provided
			? `${data.error} (needed ${data.needed}; token has ${data.provided})`
			: `${data.error} (needed ${data.needed})`

	return data.error ?? String(status)
}

/** What every Slack Web API call answers: the method's own fields plus the envelope. Named once so the wrappers below can state their returns without re-spelling it. */
export type SlackResult<T extends { [_: string]: unknown }> = Promise<
	T & { ok: boolean; error?: string; needed?: string; provided?: string }
>

/** The envelope every answer carries, and the message shapes the readers above need. Parsed, because an `ok` read off a malformed body would hide a failed call. */
const envelopeShape = {
	error: z.string().optional(),
	needed: z.string().optional(),
	ok: z.boolean(),
	provided: z.string().optional(),
}
const Envelope = z.object(envelopeShape)
type SlackEnvelope = z.infer<typeof Envelope>

const HistoryMessageSchema = z.object({
	bot_id: z.string().optional(),
	subtype: z.string().optional(),
	thread_ts: z.string().optional(),
	ts: z.string().optional(),
	type: z.string().optional(),
	user: z.string().optional(),
})
const ThreadMessageSchema = HistoryMessageSchema.extend({
	blocks: z.array(z.record(z.string(), z.unknown())).optional(),
})

async function callSlackApi<S extends z.ZodType<SlackEnvelope>>(
	schema: S,
	method: string,
	params: { [_: string]: unknown },
	/** Slack errors that are expected outcomes rather than faults. Matches are
	 *
	 * * logged at `log` level so a normal path doesn't fill the error logs.
	 */
	expectedErrors: string[] = [],
	/** Slack errors to omit from the logs entirely. Matches produce no log
	 *
	 * * line at any level.
	 */
	silentErrors: string[] = [],
): Promise<z.infer<S>> {
	const token = process.env.SLACK_BOT_TOKEN
	if (!token) throw new Error("SLACK_BOT_TOKEN is not set")

	const res = await fetch(`https://slack.com/api/${method}`, {
		body: JSON.stringify(params),
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json; charset=utf-8",
		},
		method: "POST",
		// Callers run inside `after` callbacks on the Events API path, where a hung request holds the callback open until the platform kills it. Cap it so a stalled call surfaces as a log line instead.
		signal: AbortSignal.timeout(10_000),
	})

	const parsed = schema.safeParse(await res.json().catch(() => null))
	if (!parsed.success) throw new Error(`Slack ${method} failed: an unreadable answer (HTTP ${res.status})`)
	const { data } = parsed
	if (!res.ok || !data.ok) {
		const detail = slackErrorDetail(data, res.status)
		// A silent error is an anticipated outcome noisy enough to omit entirely (e.g. inviting someone already in the channel on every join event). A matched expected error is still anticipated, but worth a normal log line rather than an error.
		if (data.error && silentErrors.includes(data.error)) {
			// Intentionally unlogged.
		} else if (data.error && expectedErrors.includes(data.error)) console.log(`Slack API ${method} failed: ${detail}`)
		else console.error(`Slack API ${method} failed: ${detail}`)
	}
	return data
}

export function postMessage(
	channel: string,
	text: string,
	opts: { blocks?: SlackBlock[]; threadTs?: string; unfurlLinks?: boolean } = {},
): SlackResult<{ ts?: string; channel?: string }> {
	return callSlackApi(
		z.object({ ...envelopeShape, channel: z.string().optional(), ts: z.string().optional() }),
		"chat.postMessage",
		{
			blocks: opts.blocks,
			channel,
			text,
			thread_ts: opts.threadTs,
			// `undefined` drops out of JSON.stringify, so callers that don't care get Slack's default; the ticket post passes true explicitly.
			unfurl_links: opts.unfurlLinks,
		},
	)
}

export function updateMessage(
	channel: string,
	ts: string,
	text: string,
	blocks?: SlackBlock[],
): Promise<SlackEnvelope> {
	return callSlackApi(Envelope, "chat.update", { blocks, channel, text, ts })
}

/** Drops a reaction on a message: the pending one when a #half-life-help question opens its ticket, the resolved one when any of the three buttons closes it. `already_reacted` is marked expected: a ticket can be resolved from the tickets channel or the help thread, so a second resolution finds the bot's own reaction already in place, which is the outcome we wanted rather than a fault. `invalid_name` – the custom emoji not existing in the workspace – is logged by the API layer since there's no runtime fix for it;
 *
 * * see `slack-app-manifest.yml` for the `reactions:write` scope this needs.
 */
export function addReaction(channel: string, timestamp: string, name: string): Promise<SlackEnvelope> {
	return callSlackApi(Envelope, "reactions.add", { channel, name, timestamp }, ["already_reacted"])
}

/** Takes a reaction back off a message, the other half of swapping a #half-life-help question from pending to resolved. `no_reaction` is marked expected for the mirror of `already_reacted` above: two people can resolve the same ticket from different places, or a Slack redelivery can rerun the handler, and whoever gets there second finds the emoji already gone – the
 *
 * * outcome we wanted rather than a fault. Same `reactions:write` scope.
 */
export function removeReaction(channel: string, timestamp: string, name: string): Promise<SlackEnvelope> {
	return callSlackApi(Envelope, "reactions.remove", { channel, name, timestamp }, ["no_reaction"])
}

/** A bot token may delete only messages that bot posted, which is the whole point here – every tickets-channel mirror is one we posted ourselves, so this needs `chat:write` and nothing more. `message_not_found` is marked expected: two people can resolve the same ticket from different places, and whoever gets there second is told the message is already gone, which is the
 *
 * * outcome we wanted rather than a fault.
 */
export function deleteMessage(channel: string, ts: string): Promise<SlackEnvelope> {
	return callSlackApi(Envelope, "chat.delete", { channel, ts }, ["message_not_found"])
}

/** `already_in_channel` is treated as success – the caller just wants the user in the channel, not a report of how they got there. It is omitted from the logs entirely: the join handler fires for every member join, so logging the no-op case buries real failures. Genuine invites still log, as
 *
 * * do genuine failures.
 */
export async function inviteToChannel(channel: string, user: string): Promise<void> {
	const result = await callSlackApi(
		Envelope,
		"conversations.invite",
		{
			channel,
			users: user,
		},
		[],
		["already_in_channel"],
	)
	if (result.ok) console.log(`Invited ${user} to ${channel}`)
	else if (result.error !== "already_in_channel")
		console.error(`Failed to invite ${user} to ${channel}: ${result.error}`)
}

/** A Slack permalink, dropped into a message's text, auto-unfurls into a rich preview of the original message (sender, avatar, timestamp, files, formatting) – the closest the Bot API gets to the client's "Forward
 *
 * * message" action, which isn't itself exposed over the API.
 */
export async function getPermalink(channel: string, messageTs: string): Promise<string | null> {
	const result = await callSlackApiGet(
		z.object({ ...envelopeShape, permalink: z.string().optional() }),
		"chat.getPermalink",
		{ channel, message_ts: messageTs },
	)
	return result.ok ? (result.permalink ?? null) : null
}

/** Slack's GET-family methods (`chat.getPermalink` among them) read their arguments from the query string – POSTing them as a JSON body gets an `invalid_arguments` back, since Slack sees no `channel`/`message_ts` at
 *
 * * all. Those methods go through here instead of `callSlackApi`.
 */
async function callSlackApiGet<S extends z.ZodType<SlackEnvelope>>(
	schema: S,
	method: string,
	params: { [_: string]: string },
): Promise<z.infer<S>> {
	const token = process.env.SLACK_BOT_TOKEN
	if (!token) throw new Error("SLACK_BOT_TOKEN is not set")

	const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`
	const res = await fetch(url, {
		headers: { authorization: `Bearer ${token}` },
		method: "GET",
		signal: AbortSignal.timeout(10_000),
	})

	const parsed = schema.safeParse(await res.json().catch(() => null))
	if (!parsed.success) throw new Error(`Slack ${method} failed: an unreadable answer (HTTP ${res.status})`)
	const { data } = parsed
	if (!res.ok || !data.ok) console.error(`Slack API ${method} failed: ${slackErrorDetail(data, res.status)}`)
	return data
}

const slackUserNameCache = new Map<string, string>()

/**
 * In-flight lookups, so two callers wanting the same name at once share one `users.info` call rather than racing a second identical request.
 *
 * A summary posts two boards and the same people are usually on both. Without this the cache only helps the *second* call, and by then the first has already gone out – so every shared name cost two requests.
 */
const slackUserNamePending = new Map<string, Promise<string>>()

/**
 * A user's display name for the daily summary's leaderboard.
 *
 * A `<@id>` mention would be simpler, but it notifies the person every single day, which is a poor trade for a stats post. Falls back to the mention only when the lookup fails, so the name is never the reason a summary breaks. Cached for the life of the instance: the summary asks once per closer, and a display name does not change mid-process.
 */
export function getSlackUserName(userId: string): Promise<string> {
	const cached = slackUserNameCache.get(userId)
	if (cached) return Promise.resolve(cached)

	const pending = slackUserNamePending.get(userId)
	if (pending) return pending

	const lookup = (async () => {
		const name = await resolveSlackUserName(userId)
		slackUserNamePending.delete(userId)
		if (!name) return `<@${userId}>`
		slackUserNameCache.set(userId, name)
		return name
	})()
	slackUserNamePending.set(userId, lookup)
	return lookup
}

/**
 * One `users.info` with nothing cached – see `getSlackUserName`, which owns the cache, the in-flight dedupe and the mention fallback.
 *
 * Null when Slack answers with no name for them, rather than throwing: a lookup miss is never the reason a summary should fail.
 */
async function resolveSlackUserName(userId: string): Promise<string | null> {
	try {
		const result = await callSlackApiGet(
			z.object({
				...envelopeShape,
				user: z
					.object({
						profile: z.object({ display_name: z.string().optional(), real_name: z.string().optional() }).optional(),
						real_name: z.string().optional(),
					})
					.optional(),
			}),
			"users.info",
			{ user: userId },
		)
		if (!result.ok) return null
		return result.user?.profile?.display_name || result.user?.profile?.real_name || result.user?.real_name || null
	} catch {
		// No token, or Slack unreachable – the mention still reads fine.
		return null
	}
}

/**
 * Display names for several users at once, for a post that names the same people in more than one board.
 *
 * `users.info` is rate-limited, and a leaderboard is exactly the shape that trips it: two boards of ten drawn from the same handful of people. Deduplicated here so a caller passes whatever ids it has and the limit is respected regardless of how much they overlap. Unknown ids still resolve to their mention, matching the single-id path.
 */
export async function getSlackUserNames(userIds: readonly string[]): Promise<Map<string, string>> {
	const ids = [...new Set(userIds)]
	const names = await Promise.all(ids.map(async id => [id, await getSlackUserName(id)] as const))
	return new Map(names)
}

let botUserId: string | null = null

/**
 * Whether a Slack user is in a channel the bot can see, with the reason kept when the answer is no.
 *
 * The help channel is joined by every participant, so the thread's "Mark as helped" button is gated on membership of the private tickets channel the bot posts to. Fails closed: an unreadable member list refuses the action rather than opening it to the room.
 *
 * `error` is set when the member list itself was unreadable – `missing_scope` because the manifest's `groups:read` was added but never re-imported and reinstalled, or `channel_not_found`/`not_in_channel` because the bot was never invited into the private channel. Callers use it to tell "you're not on the team" apart from "the check itself is broken, tell an admin", since only the first is the clicker's problem.
 */
export interface ChannelMembership {
	error?: string
	member: boolean
}

export async function checkChannelMembership(channel: string, user: string): Promise<ChannelMembership> {
	let cursor: string | undefined
	for (let page = 0; page < 10; page += 1) {
		const result = await callSlackApiGet(
			z.object({
				...envelopeShape,
				members: z.array(z.string()).optional(),
				response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
			}),
			"conversations.members",
			{ channel, limit: "200", ...(cursor ? { cursor } : {}) },
		)
		if (!result.ok || !Array.isArray(result.members)) {
			const detail =
				result.error === "missing_scope" && result.needed
					? `${result.error} (needed ${result.needed})`
					: (result.error ?? "bad_response")
			return { error: detail, member: false }
		}
		if (result.members.includes(user)) return { member: true }
		cursor = result.response_metadata?.next_cursor || undefined
		if (!cursor) return { member: false }
	}
	return { member: false }
}

export async function isChannelMember(channel: string, user: string): Promise<boolean> {
	const membership = await checkChannelMembership(channel, user)
	return membership.member
}

/** A message as `conversations.history` returns it, trimmed to the fields that
 *
 * * decide whether it opened a ticket.
 */
export interface SlackHistoryMessage {
	bot_id?: string
	subtype?: string
	thread_ts?: string
	ts?: string
	type?: string
	user?: string
}

/** A message as `conversations.replies` returns it, carrying the blocks a
 *
 * * caller needs to rewrite one.
 */
export interface SlackThreadMessage extends SlackHistoryMessage {
	blocks?: SlackBlock[]
}

/**
 * Every message in one thread, oldest first – the parent question and its replies.
 *
 * The tickets-channel "mark as helped" button resolves a ticket from a different channel than the thread it belongs to, so unlike the in-thread button it cannot read the reminder message it has to rewrite off the interaction payload. This is how it finds that message.
 *
 * Throws on a Slack error rather than returning a short list, like `listChannelHistory`, so a failed read surfaces in the caller's guard instead of silently leaving the thread unresolved. The reminder is the thread's first reply, so one page of Slack's default `limit` always covers it – a help thread never runs long enough to page.
 */
export async function getThreadReplies(channel: string, ts: string): Promise<SlackThreadMessage[]> {
	const result = await callSlackApiGet(
		z.object({ ...envelopeShape, messages: z.array(ThreadMessageSchema).optional() }),
		"conversations.replies",
		{ channel, limit: "200", ts },
	)
	if (!result.ok) throw new Error(`conversations.replies failed: ${result.error ?? "unknown error"}`)
	return result.messages ?? []
}

/**
 * Walks a channel's whole history and hands back every message it saw.
 *
 * `conversations.history` pages newest-first; the cursor carries us further back until Slack has no more or `maxPages` trips – a guard so a one-off backfill cannot hammer the API forever. `exhausted` is false when that guard tripped, so the caller can say the sweep was partial instead of quietly undercounting.
 *
 * Throws on a Slack error rather than returning a short list: the backfill that uses this is idempotent, so a `ratelimited` should fail loudly and be re-run, not silently leave the table half-filled.
 */
export async function listChannelHistory(
	channel: string,
	opts: { maxPages?: number } = {},
): Promise<{ messages: SlackHistoryMessage[]; exhausted: boolean }> {
	const maxPages = opts.maxPages ?? 200
	const messages: SlackHistoryMessage[] = []
	let cursor: string | undefined
	for (let page = 0; page < maxPages; page += 1) {
		const result = await callSlackApiGet(
			z.object({
				...envelopeShape,
				messages: z.array(HistoryMessageSchema).optional(),
				response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
			}),
			"conversations.history",
			{ channel, limit: "200", ...(cursor ? { cursor } : {}) },
		)
		if (!result.ok) throw new Error(`conversations.history failed: ${result.error ?? "unknown error"}`)
		messages.push(...(result.messages ?? []))
		cursor = result.response_metadata?.next_cursor || undefined
		if (!cursor) return { exhausted: true, messages }
	}
	return { exhausted: false, messages }
}

/** Cached for the life of the instance – this never changes for a given bot token, and calling auth.test on every event would be wasted latency
 *
 * * inside Slack's 3-second Events API window.
 */
export async function getBotUserId(): Promise<string | null> {
	if (botUserId) return botUserId
	const result = await callSlackApi(z.object({ ...envelopeShape, user_id: z.string().optional() }), "auth.test", {})
	botUserId = result.user_id ?? null
	return botUserId
}

/**
 * HMAC verification per Slack's signing secret scheme: reject anything older than 5 minutes (replay window) and anything whose signature doesn't match, using a timing-safe comparison so the check itself can't leak information via response time.
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

export type VerifiedSlackRequest = { ok: true; rawBody: string } | { ok: false; status: 413 | 401 }

/**
 * Read and verify a Slack request in one step, for both the Events and Interactivity endpoints.
 *
 * The body is bounded before verification: an unsigned caller must not decide how much memory the HMAC read may spend. Keeping the two steps together is what stops a route from reading the body first and verifying it later, or forgetting the check altogether.
 *
 * A refusal carries the status to answer with – 413 for an over-sized body, 401 for a bad signature – while the route keeps its own body shape, which differs between the two endpoints.
 */
export async function readVerifiedSlackRequest(request: Request): Promise<VerifiedSlackRequest> {
	const rawBody = await readBoundedText(request)
	if (rawBody === null) return { ok: false, status: 413 }

	const verified = verifySlackRequest(
		rawBody,
		request.headers.get("x-slack-request-timestamp"),
		request.headers.get("x-slack-signature"),
	)
	return verified ? { ok: true, rawBody } : { ok: false, status: 401 }
}
