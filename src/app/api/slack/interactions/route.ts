import { after, NextResponse } from "next/server"
import {
	addReaction,
	checkChannelMembership,
	getThreadReplies,
	postMessage,
	removeReaction,
	type SlackBlock,
	updateMessage,
	verifySlackRequest,
} from "@/lib/site/slack"
import { countPriorHelpTickets, reopenHelpTicket, resolveHelpTicket } from "@/lib/site/ticket-store"
import {
	carriesResolveActions,
	deleteTicketMessage,
	helpedAck,
	MARK_HELPED_BUTTON,
	PENDING_REACTION,
	RESOLVED_REACTION,
	reopenBlocks,
	reopenedAck,
	resolveBlocks,
	selfResolvedAck,
	TICKET_ACTIONS_BLOCK_ID,
	type TicketRef,
	ticketHistory,
	ticketSection,
} from "@/lib/site/tickets"

export const runtime = "nodejs"

interface BlockAction {
	action_id: string
	value?: string
}

interface InteractionPayload {
	actions?: BlockAction[]
	/** Present only on the `url_verification` challenge Slack sends first. */
	challenge?: string
	channel?: { id: string }
	message?: { ts: string; blocks?: SlackBlock[] }
	response_url?: string
	type: string
	user: { id: string }
}

/** The only origin Slack sets `response_url` to. */
const SLACK_RESPONSE_ORIGIN = "https://hooks.slack.com"

/**
 * Slack always sets `response_url` to `https://hooks.slack.com/...`, but the value arrives inside the interaction body, so CodeQL (correctly) treats it as attacker-shaped input. The request signature already proves Slack sent it – see `verifySlackRequest` – so this is defence in depth. The returned string is rebuilt from a constant origin: the host can never be steered by the payload, only the path and query are taken from Slack.
 */
function slackResponseUrl(value: string): string | null {
	try {
		const url = new URL(value)
		if (url.hostname !== "hooks.slack.com") return null
		return `${SLACK_RESPONSE_ORIGIN}${url.pathname}${url.search}`
	} catch {
		return null
	}
}

/**
 * Posts a message only the interacting user can see, via the short-lived `response_url` in the interaction payload.
 *
 * `replace_original: false` is load-bearing: Slack replaces the source message with an interaction response unless told otherwise, so without it the ephemeral denial would overwrite the ticket message for the clicker rather than appear beside it. Showing both fields is the shape Slack's own error-message example uses.
 */
async function respondEphemeral(responseUrl: string, text: string) {
	const target = slackResponseUrl(responseUrl)
	if (!target) {
		console.error("Refusing to post ephemeral response: URL is not a Slack hooks host")
		return
	}

	try {
		await fetch(target, {
			body: JSON.stringify({ replace_original: false, response_type: "ephemeral", text }),
			headers: { "content-type": "application/json" },
			method: "POST",
			signal: AbortSignal.timeout(10_000),
		})
	} catch (err) {
		console.error(`Failed to post ephemeral response: ${String(err)}`)
	}
}

/**
 * Swaps the original #half-life-help question's reaction from pending to resolved: the loading emoji comes off, the done one goes on, so the channel shows the question is answered rather than still waiting.
 *
 * Best-effort: the reaction is a nice-to-have marker, so a Slack call that fails here (the custom emoji missing from the workspace, the question deleted) must not sink the ack that follows it. The two calls are guarded separately so one failure still leaves the other half of the swap to land. Guarded on the ref carrying a help thread, which every resolution button does but a malformed value might not.
 */
async function reactResolved(ref: Partial<TicketRef>) {
	if (!ref.helpChannel || !ref.helpTs) return
	try {
		await removeReaction(ref.helpChannel, ref.helpTs, PENDING_REACTION)
	} catch (err) {
		console.error(`Failed to clear the pending reaction: ${String(err)}`)
	}
	try {
		await addReaction(ref.helpChannel, ref.helpTs, RESOLVED_REACTION)
	} catch (err) {
		console.error(`Failed to add resolved reaction: ${String(err)}`)
	}
}

/** The reopen button's value, or undefined when the ref is too malformed to rebuild from. The ticket resolves either way – a thread without a way back is degraded, not broken. */
function reopenRefFrom(ref: Partial<TicketRef & { ticketsChannel: string }>) {
	return ref.authorId && ref.helpChannel && ref.helpTs && ref.ticketsChannel
		? {
				authorId: ref.authorId,
				helpChannel: ref.helpChannel,
				helpTs: ref.helpTs,
				permalink: ref.permalink ?? null,
				ticketsChannel: ref.ticketsChannel,
			}
		: undefined
}

/** Staff clicking "Mark as helped" in the tickets channel – gated on
 * membership of the private tickets channel, like the thread path below. The request signature already proves Slack sent it; this is defence in depth so a leaked message-ts pair or a future workspace-wide action with
 * the same action_id cannot resolve tickets as any Slack identity. Denials answer ephemerally so the clicker knows whether they lack membership or the membership check itself is broken (missing scope, bot not in the channel), instead of the click silently doing nothing.
 *
 * Resolving here lands where the in-thread button lands: the help thread's reminder is rewritten into its resolved state, and the tickets-channel mirror leaves the queue. The mirror is the message the button was clicked on, so its coordinates are on the payload rather than the ref. */
async function handleMarkHelped(payload: InteractionPayload, action: BlockAction) {
	if (!payload.channel?.id || !payload.message?.ts) return

	const ticketsChannel = process.env.SLACK_TICKETS_CHANNEL_ID
	// The button lives on the ticket mirror, so the interaction must come from the tickets channel itself, clicked by someone in it. Fail closed when the channel is not configured – checkChannelMembership already does on API failure.
	if (!ticketsChannel) {
		console.error("mark_helped dropped: SLACK_TICKETS_CHANNEL_ID is not set")
		return
	}
	if (payload.channel.id !== ticketsChannel) return

	const membership = await checkChannelMembership(ticketsChannel, payload.user.id)
	if (membership.error) {
		console.error(
			`mark_helped denied by unreadable member list: channel ${ticketsChannel}, user ${payload.user.id}, Slack error ${membership.error} – re-import slack-app-manifest.yml, reinstall the app, and invite the bot into the private tickets channel`,
		)
		if (payload.response_url)
			await respondEphemeral(
				payload.response_url,
				"I couldn't verify the team list just now, so I left the ticket alone – tell an admin to check the app logs for the Slack API error.",
			)
		return
	}
	if (!membership.member) {
		if (payload.response_url)
			await respondEphemeral(payload.response_url, "Only the Half Life team can resolve a ticket.")
		return
	}

	let ref: Partial<TicketRef> = {}
	try {
		ref = action.value ? (JSON.parse(action.value) as Partial<TicketRef>) : {}
	} catch {
		// Malformed value – still clear the mirror below.
	}

	if (ref.helpChannel && ref.helpTs) {
		// The thread reminder's ts is not carried on this payload, so read the thread to find it and make the same rewrite the in-thread button makes. The mirror is clicked from the tickets channel while the reminder lives in the help thread, which is why this path needs the read and the in-thread path does not. Best-effort like the rest of the file – a failed read must not leave the ticket sitting in the queue or the database.
		try {
			const replies = await getThreadReplies(ref.helpChannel, ref.helpTs)
			const reminder = replies.find(reply => carriesResolveActions(reply.blocks))
			if (reminder?.ts) {
				const reopenRef = reopenRefFrom({ ...ref, ticketsChannel })
				await updateMessage(
					ref.helpChannel,
					reminder.ts,
					helpedAck(payload.user.id),
					resolveBlocks(reminder.blocks, payload.user.id, undefined, reopenRef),
				)
			} else console.error(`mark_helped found no reminder to mark helped in thread ${ref.helpTs}`)
		} catch (err) {
			console.error(`Failed to mark help thread ${ref.helpTs} as helped: ${String(err)}`)
		}

		// Best-effort: a database hiccup must not sink the resolution.
		try {
			await resolveHelpTicket({ helpChannel: ref.helpChannel, helpTs: ref.helpTs, resolvedBy: payload.user.id })
		} catch (err) {
			console.error(`Failed to record ticket resolution for ${ref.helpTs}: ${String(err)}`)
		}
	}

	// Out of the queue, like the in-thread path. Fall back to editing it into its resolved state if the delete fails, so a ticket is never left sitting there with a live button.
	try {
		if (!(await deleteTicketMessage(payload.channel.id, payload.message.ts)))
			await updateMessage(payload.channel.id, payload.message.ts, `Ticket resolved by <@${payload.user.id}>`, [
				ticketSection(ref as TicketRef),
				...resolveBlocks(undefined, payload.user.id),
			])
	} catch (err) {
		console.error(`Failed to clear the tickets-channel message: ${String(err)}`)
	}

	await reactResolved(ref)
}

/** The ticket's own author clicking "I'm all set" in the help-channel
 * thread – restricted to whoever opened the ticket, so someone else in the thread can't close it out from under them. Also clears the ticket out of the
 * tickets channel so staff see it's already handled. */
async function handleSelfResolve(payload: InteractionPayload, action: BlockAction) {
	if (!payload.channel?.id || !payload.message?.ts) return

	let ref: Partial<TicketRef & { ticketsChannel: string; ticketsTs: string }> = {}
	try {
		ref = action.value
			? (JSON.parse(action.value) as Partial<TicketRef & { ticketsChannel: string; ticketsTs: string }>)
			: {}
	} catch {
		return
	}

	if (!ref.authorId || payload.user.id !== ref.authorId) {
		if (payload.response_url)
			await respondEphemeral(
				payload.response_url,
				'Only the person who asked can close it themselves – helpers can use "Mark as helped" right here in the thread.',
			)

		return
	}

	await updateMessage(
		payload.channel.id,
		payload.message.ts,
		selfResolvedAck(),
		resolveBlocks(payload.message.blocks, payload.user.id, undefined, reopenRefFrom(ref)),
	)

	if (ref.helpChannel && ref.helpTs)
		// Best-effort, like the helper path – the ack above already went out.
		try {
			await resolveHelpTicket({ helpChannel: ref.helpChannel, helpTs: ref.helpTs, resolvedBy: payload.user.id })
		} catch (err) {
			console.error(`Failed to record ticket resolution for ${ref.helpTs}: ${String(err)}`)
		}

	if (ref.ticketsChannel && ref.ticketsTs && ref.helpChannel)
		try {
			if (!(await deleteTicketMessage(ref.ticketsChannel, ref.ticketsTs)))
				await updateMessage(ref.ticketsChannel, ref.ticketsTs, `Ticket resolved by <@${payload.user.id}>`, [
					ticketSection(ref as TicketRef),
					...resolveBlocks(undefined, payload.user.id, "marked it themselves"),
				])
		} catch (err) {
			console.error(`Failed to clear the tickets-channel message: ${String(err)}`)
		}

	await reactResolved(ref)
}

/** A helper clicking "Mark as helped" in the help-channel thread – the ask
 * from the helpers, so nobody has to jump over to the tickets channel to close a ticket. Resolves both the thread ack and the tickets-channel
 * message, mirroring what the staff-side button does. */
async function handleThreadMarkHelped(payload: InteractionPayload, action: BlockAction) {
	if (!payload.channel?.id || !payload.message?.ts) return

	let ref: Partial<TicketRef & { ticketsChannel: string; ticketsTs: string }> = {}
	try {
		ref = action.value
			? (JSON.parse(action.value) as Partial<TicketRef & { ticketsChannel: string; ticketsTs: string }>)
			: {}
	} catch {
		return
	}

	// The help channel is open to every participant, so the button is gated on membership of the private tickets channel the bot posts to – the same people who can resolve it from there.
	if (!ref.ticketsChannel) {
		console.error("mark_helped_from_thread dropped: ticket carries no tickets-channel reference")
		if (payload.response_url)
			await respondEphemeral(
				payload.response_url,
				"I couldn't verify the team list just now, so I left the ticket alone – tell an admin to check the app logs for the Slack API error.",
			)
		return
	}
	const membership = await checkChannelMembership(ref.ticketsChannel, payload.user.id)
	if (membership.error) {
		console.error(
			`mark_helped_from_thread denied by unreadable member list: channel ${ref.ticketsChannel}, user ${payload.user.id}, Slack error ${membership.error} – re-import slack-app-manifest.yml, reinstall the app, and invite the bot into the private tickets channel`,
		)
		if (payload.response_url)
			await respondEphemeral(
				payload.response_url,
				"I couldn't verify the team list just now, so I left the ticket alone – tell an admin to check the app logs for the Slack API error.",
			)
		return
	}
	if (!membership.member) {
		if (payload.response_url)
			await respondEphemeral(payload.response_url, "Only the Half Life team can resolve a ticket from the thread.")
		return
	}

	await updateMessage(
		payload.channel.id,
		payload.message.ts,
		helpedAck(payload.user.id),
		resolveBlocks(payload.message.blocks, payload.user.id, undefined, reopenRefFrom(ref)),
	)

	if (ref.helpChannel && ref.helpTs)
		// Best-effort, like the staff-channel path.
		try {
			await resolveHelpTicket({ helpChannel: ref.helpChannel, helpTs: ref.helpTs, resolvedBy: payload.user.id })
		} catch (err) {
			console.error(`Failed to record ticket resolution for ${ref.helpTs}: ${String(err)}`)
		}

	if (ref.ticketsChannel && ref.ticketsTs && ref.helpChannel)
		try {
			if (!(await deleteTicketMessage(ref.ticketsChannel, ref.ticketsTs)))
				await updateMessage(ref.ticketsChannel, ref.ticketsTs, `Ticket resolved by <@${payload.user.id}>`, [
					ticketSection(ref as TicketRef),
					...resolveBlocks(undefined, payload.user.id),
				])
		} catch (err) {
			console.error(`Failed to clear the tickets-channel message: ${String(err)}`)
		}

	await reactResolved(ref)
}

/** The reopen button on a resolved thread message – the asker whose problem came back, or a helper who sees it needs more.
 * Gated like the resolve buttons: the author, or the team that owns the tickets channel. Anyone else gets an ephemeral denial rather than a silent nothing. */
async function handleReopen(payload: InteractionPayload, action: BlockAction) {
	if (!payload.channel?.id || !payload.message?.ts) return

	let ref: Partial<TicketRef & { ticketsChannel: string }> = {}
	try {
		ref = action.value ? (JSON.parse(action.value) as Partial<TicketRef & { ticketsChannel: string }>) : {}
	} catch {
		return
	}
	if (!ref.authorId || !ref.helpChannel || !ref.helpTs) return
	const ticketsChannel = ref.ticketsChannel ?? process.env.SLACK_TICKETS_CHANNEL_ID
	if (!ticketsChannel) {
		console.error("reopen_ticket dropped: no tickets channel on the ref or in env")
		if (payload.response_url)
			await respondEphemeral(
				payload.response_url,
				"I couldn't figure out where the tickets live, so I left this one alone – tell an admin to check the app logs.",
			)
		return
	}

	const isAuthor = payload.user.id === ref.authorId
	const membership = isAuthor ? null : await checkChannelMembership(ticketsChannel, payload.user.id)
	if (!isAuthor && (membership?.error || !membership?.member)) {
		if (membership?.error)
			console.error(
				`reopen_ticket denied by unreadable member list: channel ${ticketsChannel}, user ${payload.user.id}, Slack error ${membership.error}`,
			)
		if (payload.response_url)
			await respondEphemeral(
				payload.response_url,
				membership?.error
					? "I couldn't verify the team list just now, so I left this one alone – tell an admin to check the app logs for the Slack API error."
					: "Only the person who asked, or the Half Life team, can reopen a ticket.",
			)
		return
	}

	// The database first: a double-clicked button arrives twice with the same stale blocks, and only the first may rewrite anything. A ticket with no row (asked before the table existed) reopens purely in Slack.
	let reopened = false
	try {
		reopened = await reopenHelpTicket({ helpChannel: ref.helpChannel, helpTs: ref.helpTs })
	} catch (err) {
		console.error(`Failed to reopen ticket ${ref.helpTs}: ${String(err)}`)
	}
	if (!reopened) return

	// Back in the queue: the mirror was deleted on resolve, so staff need a fresh one. Best-effort like the rest of this file – the thread below reopens regardless.
	// The row itself counts in the history read, so one is subtracted: at creation the row does not exist yet and the count excludes it.
	let ticketsTs: string | null = null
	try {
		const priorTickets = Math.max(0, (await countPriorHelpTickets(ref.authorId)) - 1)
		const threadRef = {
			authorId: ref.authorId,
			helpChannel: ref.helpChannel,
			helpTs: ref.helpTs,
			permalink: ref.permalink ?? null,
		}
		const mirrorBlocks: SlackBlock[] = [
			ticketSection(threadRef),
			ticketHistory(ref.authorId, priorTickets),
			{
				block_id: TICKET_ACTIONS_BLOCK_ID,
				elements: [
					{
						action_id: "mark_helped",
						style: "primary",
						text: { emoji: true, text: MARK_HELPED_BUTTON, type: "plain_text" },
						type: "button",
						value: JSON.stringify(threadRef),
					},
				],
				type: "actions",
			},
		]
		const mirror = await postMessage(
			ticketsChannel,
			threadRef.permalink
				? `Reopened ticket from <@${ref.authorId}>: ${threadRef.permalink}`
				: `Reopened ticket from <@${ref.authorId}>`,
			{ blocks: mirrorBlocks, unfurlLinks: true },
		)
		if (mirror.ok && mirror.ts) ticketsTs = mirror.ts
		else
			console.error(
				`[slack] reopened ticket mirror post to ${ticketsChannel} failed (${mirror.error ?? "no message ts"})`,
			)
	} catch (err) {
		console.error(`[slack] failed to re-queue reopened ticket ${ref.helpTs}: ${String(err)}`)
	}

	// The thread goes back to exactly the open state: reminders-era buttons rebuilt with the fresh mirror reference, reopen button and resolved note stripped.
	const threadRef = {
		authorId: ref.authorId,
		helpChannel: ref.helpChannel,
		helpTs: ref.helpTs,
		permalink: ref.permalink ?? null,
		ticketsChannel,
		...(ticketsTs ? { ticketsTs } : {}),
	}
	try {
		await updateMessage(
			payload.channel.id,
			payload.message.ts,
			reopenedAck(),
			reopenBlocks(payload.message.blocks, threadRef),
		)
	} catch (err) {
		console.error(`Failed to rewrite reopened thread message ${ref.helpTs}: ${String(err)}`)
	}

	// Reactions swap back: done off, waiting on.
	if (ref.helpChannel && ref.helpTs) {
		try {
			await removeReaction(ref.helpChannel, ref.helpTs, RESOLVED_REACTION)
		} catch (err) {
			console.error(`Failed to clear the resolved reaction: ${String(err)}`)
		}
		try {
			await addReaction(ref.helpChannel, ref.helpTs, PENDING_REACTION)
		} catch (err) {
			console.error(`Failed to re-add the pending reaction: ${String(err)}`)
		}
	}
}

export async function POST(request: Request): Promise<NextResponse> {
	const rawBody = await request.text()

	const verified = verifySlackRequest(
		rawBody,
		request.headers.get("x-slack-request-timestamp"),
		request.headers.get("x-slack-signature"),
	)
	if (!verified) return NextResponse.json({ ok: false }, { status: 401 })

	// Interactivity payloads arrive form-encoded with the JSON under `payload`. The first thing Slack sends to a newly saved Request URL is a `url_verification` challenge, and it arrives the same way.
	const form = new URLSearchParams(rawBody)
	const raw = form.get("payload") ?? (rawBody.trimStart().startsWith("{") ? rawBody : null)
	if (!raw) return NextResponse.json({ ok: false }, { status: 400 })

	let payload: InteractionPayload
	try {
		payload = JSON.parse(raw) as InteractionPayload
	} catch {
		return NextResponse.json({ ok: false }, { status: 400 })
	}

	// Slack refuses to save the interactivity Request URL unless the challenge is echoed verbatim, so this has to be answered before anything else.
	if (payload.type === "url_verification") return NextResponse.json({ challenge: payload.challenge })

	// Slack retries an interaction it has not seen a 200 for within 3 seconds, and these handlers make up to two Slack calls each. Ack first and run the work in `after`, so a slow call cannot cause a duplicate resolution; the same reasoning the events route uses. A retry that still arrives is dropped – the original delivery was already accepted.
	if (request.headers.get("x-slack-retry-num")) return NextResponse.json({ ok: true })

	if (payload.type === "block_actions") {
		const action = payload.actions?.[0]
		after(async () => {
			try {
				if (action?.action_id === "mark_helped") await handleMarkHelped(payload, action)
				else if (action?.action_id === "mark_resolved_by_author") await handleSelfResolve(payload, action)
				else if (action?.action_id === "mark_helped_from_thread") await handleThreadMarkHelped(payload, action)
				else if (action?.action_id === "reopen_ticket") await handleReopen(payload, action)
			} catch (err) {
				// The response is already sent and Slack has its 200, so the log is the only trace a failure leaves.
				console.error("[slack] interaction handler threw:", err)
			}
		})
	}

	return NextResponse.json({ ok: true })
}
