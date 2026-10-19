import { after, NextResponse } from "next/server"
import {
	addReaction,
	getBotUserId,
	getPermalink,
	inviteToChannel,
	postMessage,
	type SlackBlock,
	verifySlackRequest,
} from "@/lib/site/slack"
import { countPriorHelpTickets, rememberHelpTicket } from "@/lib/site/ticket-store"
import {
	FAQ_CARD_BUTTON,
	FAQ_CARD_TITLE,
	HELP_THREAD_REMINDERS,
	MARK_HELPED_BUTTON,
	PENDING_REACTION,
	TICKET_ACTIONS_BLOCK_ID,
	type TicketRef,
	threadResolveActions,
	ticketHistory,
	ticketSection,
} from "@/lib/site/tickets"

// Signature verification needs Node's crypto, not the edge runtime.
export const runtime = "nodejs"

interface SlackEvent {
	bot_id?: string
	channel?: string
	subtype?: string
	text?: string
	thread_ts?: string
	ts?: string
	type: string
	user?: string
}

/** New top-level message in #half-life-help – post it to the private
 * tickets channel with a "Mark as helped" button, reply in-thread with an "I'm all set" button the ticket's own author can use to self-resolve, and drop the pending reaction on the original so the channel shows at a glance that it's still waiting. Thread replies and anything from a bot (including our own acks) are
 * conversation on an existing ticket, not a new one. A message that shares a file (e.g. a photo of a build) arrives with subtype `file_share`, so that one still opens a ticket – every other subtype (edits, deletes, joins, broadcasts) does not. */
async function handleHelpMessage(event: SlackEvent) {
	const ticketsChannel = process.env.SLACK_TICKETS_CHANNEL_ID
	if (!ticketsChannel) return
	if (event.bot_id || event.thread_ts) return
	if (event.subtype && event.subtype !== "file_share") return
	if (!event.user || !event.ts || !event.channel) return

	const permalink = await getPermalink(event.channel, event.ts)

	const ref: TicketRef = {
		authorId: event.user,
		helpChannel: event.channel,
		helpTs: event.ts,
		permalink,
	}

	// Best-effort: a database hiccup must not keep the ticket out of the queue, it just means the mirror goes without the history line.
	let priorTickets: number | null = null
	try {
		priorTickets = await countPriorHelpTickets(ref.authorId)
	} catch (err) {
		console.error(`[slack] failed to read ticket history for ${ref.helpTs}:`, err)
	}

	const ticketBlocks: SlackBlock[] = [ticketSection(ref)]
	if (priorTickets !== null) ticketBlocks.push(ticketHistory(ref.authorId, priorTickets))
	ticketBlocks.push({
		block_id: TICKET_ACTIONS_BLOCK_ID,
		elements: [
			{
				action_id: "mark_helped",
				style: "primary",
				text: { emoji: true, text: MARK_HELPED_BUTTON, type: "plain_text" },
				type: "button",
				value: JSON.stringify(ref),
			},
		],
		type: "actions",
	})

	// The permalink rides in the top-level text as well as the section block: Slack unfurls text-based links only there, never inside blocks, so this is what gets the original message previewed under the ticket.
	const ticketMessage = await postMessage(
		ticketsChannel,
		permalink ? `New ticket from <@${ref.authorId}>: ${permalink}` : `New ticket from <@${ref.authorId}>`,
		{ blocks: ticketBlocks, unfurlLinks: true },
	)
	if (!ticketMessage.ok || !ticketMessage.ts) {
		// A failed mirror means no ticket exists, so the help-channel ack below is skipped too. The response already went out, so the log is the only trace.
		console.error(
			`[slack] ticket post to ${ticketsChannel} failed (${ticketMessage.error ?? "no message ts"}); no help-channel ack for ${ref.helpTs}`,
		)
		return
	}

	// The ticket is real, so the question now has an open state to show for it: a loading emoji on the original, which resolution swaps for the done one. Best-effort – the two buttons are what actually resolve the ticket, so a reaction that never lands just leaves the question unmarked rather than unresolvable.
	try {
		await addReaction(ref.helpChannel, ref.helpTs, PENDING_REACTION)
	} catch (err) {
		console.error(`[slack] failed to mark ${ref.helpTs} as pending:`, err)
	}

	// The mirror is up, so the ticket is real – remember it for future counts.
	try {
		await rememberHelpTicket({
			authorSlackId: ref.authorId,
			helpChannel: ref.helpChannel,
			helpTs: ref.helpTs,
		})
	} catch (err) {
		console.error(`[slack] failed to record ticket for ${ref.helpTs}:`, err)
	}

	// Carried by both buttons: the author's self-resolve and the helpers' in-thread "Mark as helped" both need the tickets-channel target to sync.
	const resolveRef = {
		...ref,
		ticketsChannel,
		ticketsTs: ticketMessage.ts,
	}

	const selfResolveBlocks: SlackBlock[] = [
		{
			text: {
				text: HELP_THREAD_REMINDERS,
				type: "mrkdwn",
			},
			type: "section",
		},
		{
			actions: [
				{
					action_id: "faq_link_click",
					text: {
						text: FAQ_CARD_BUTTON,
						type: "plain_text",
					},
					type: "button",
					url: "https://hackclub.enterprise.slack.com/docs/T0266FRGM/F0C0Q6UEPCH",
				},
			],
			icon: {
				alt_text: "Gato",
				image_url: "https://user-cdn.hackclub-assets.com/01a087a6-3340-75f4-bed9-26f40c4fffe7/gato_schematic.png",
				type: "image",
			},
			title: {
				text: FAQ_CARD_TITLE,
				type: "mrkdwn",
				verbatim: false,
			},
			type: "card",
		},
		threadResolveActions(resolveRef),
	]

	// The thread's top-level text repeats the reminders above rather than carrying new information: it's what a notification preview shows, and it's what a screen reader reads out.
	await postMessage(ref.helpChannel, HELP_THREAD_REMINDERS, {
		blocks: selfResolveBlocks,
		threadTs: ref.helpTs,
	})
}

/** Someone joined the main channel – pull them into the rest of the Half
 * Life channels too. Skips the bot's own membership changes so wiring the
 * bot into the main channel doesn't loop back into inviting itself. */
async function handleMainChannelJoin(event: SlackEvent) {
	const mainChannel = process.env.SLACK_MAIN_CHANNEL_ID
	const joined = event.user
	if (!mainChannel || event.channel !== mainChannel || !joined) return

	const botUserId = await getBotUserId()
	if (joined === botUserId) return

	const targets = [process.env.SLACK_BULLETIN_CHANNEL_ID, process.env.SLACK_HELP_CHANNEL_ID].filter(
		(id): id is string => Boolean(id),
	)

	if (targets.length === 0) {
		console.error("member_joined_channel fired but neither SLACK_BULLETIN_CHANNEL_ID nor SLACK_HELP_CHANNEL_ID is set")
		return
	}

	await Promise.all(targets.map(channel => inviteToChannel(channel, joined)))
}

export async function POST(request: Request): Promise<NextResponse> {
	const rawBody = await request.text()

	const verified = verifySlackRequest(
		rawBody,
		request.headers.get("x-slack-request-timestamp"),
		request.headers.get("x-slack-signature"),
	)
	if (!verified) return NextResponse.json({ ok: false }, { status: 401 })

	let body: { type?: string; challenge?: string; event?: SlackEvent }
	try {
		body = JSON.parse(rawBody)
	} catch {
		return NextResponse.json({ ok: false }, { status: 400 })
	}

	if (body.type === "url_verification") return NextResponse.json({ challenge: body.challenge })

	// Slack retries delivery if it doesn't get a 200 within 3s. Reprocessing a retry would double-invite members and double-post tickets, so only the original delivery is handled – Slack has already gotten the point across.
	if (request.headers.get("x-slack-retry-num")) return NextResponse.json({ ok: true })

	if (body.type === "event_callback" && body.event) {
		const event = body.event
		// Ack first, work second. Slack abandons a delivery it hasn't seen a 200 for within 3s and retries, and the guard above drops every retry – so if a slow Slack call held the response open past that window, the retry carrying the same work would be discarded and the invite lost with nothing in the logs. `after` keeps the response instant so the retry path stays a genuine safety net rather than a silent failure.
		after(async () => {
			try {
				if (event.type === "member_joined_channel") await handleMainChannelJoin(event)
				else if (event.type === "message" && event.channel === process.env.SLACK_HELP_CHANNEL_ID)
					await handleHelpMessage(event)
			} catch (err) {
				// Nothing above this frame can observe a failure – the response is already sent and Slack has its 200 – so the log is the only trace.
				console.error("[slack] event handler threw:", err)
			}
		})
	}

	return NextResponse.json({ ok: true })
}
