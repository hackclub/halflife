import { after, NextResponse } from "next/server"
import { isChannelMember, postMessage, type SlackBlock, updateMessage, verifySlackRequest } from "@/lib/site/slack"
import { resolveBlocks, type TicketRef, ticketSection } from "@/lib/site/tickets"

export const runtime = "nodejs"

type BlockAction = {
	action_id: string
	value?: string
}

type InteractionPayload = {
	type: string
	/** Present only on the `url_verification` challenge Slack sends first. */
	challenge?: string
	user: { id: string }
	channel?: { id: string }
	message?: { ts: string; blocks?: SlackBlock[] }
	actions?: BlockAction[]
	response_url?: string
}

/** The only origin Slack sets `response_url` to. */
const SLACK_RESPONSE_ORIGIN = "https://hooks.slack.com"

/**
 * Slack always sets `response_url` to `https://hooks.slack.com/...`, but the
 * value arrives inside the interaction body, so CodeQL (correctly) treats it as
 * attacker-shaped input. The request signature already proves Slack sent it —
 * see `verifySlackRequest` — so this is defence in depth. The returned string is
 * rebuilt from a constant origin: the host can never be steered by the payload,
 * only the path and query are taken from Slack.
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

async function respondEphemeral(responseUrl: string, text: string) {
	const target = slackResponseUrl(responseUrl)
	if (!target) {
		console.error("Refusing to post ephemeral response: URL is not a Slack hooks host")
		return
	}

	try {
		await fetch(target, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ response_type: "ephemeral", text }),
			signal: AbortSignal.timeout(10_000),
		})
	} catch (err) {
		console.error(`Failed to post ephemeral response: ${err}`)
	}
}

/** Staff clicking "Mark as helped" in the tickets channel — no permission
 * check, anyone with access to that private channel can resolve a ticket. */
async function handleMarkHelped(payload: InteractionPayload, action: BlockAction) {
	if (!payload.channel?.id || !payload.message?.ts) return

	let ref: Partial<TicketRef> = {}
	try {
		ref = action.value ? JSON.parse(action.value) : {}
	} catch {
		// Malformed value — still resolve the tickets-channel message below.
	}

	await updateMessage(
		payload.channel.id,
		payload.message.ts,
		`Ticket resolved by <@${payload.user.id}>`,
		resolveBlocks(payload.message.blocks, payload.user.id),
	)

	if (ref.helpChannel && ref.helpTs) {
		try {
			await postMessage(ref.helpChannel, `You're all set — <@${payload.user.id}> marked this as helped.`, {
				threadTs: ref.helpTs,
			})
		} catch (err) {
			console.error(`Failed to post help-channel ack: ${err}`)
		}
	}
}

/** The ticket's own author clicking "I'm all set" in the help-channel
 * thread — restricted to whoever opened the ticket, so someone else in the
 * thread can't close it out from under them. Also syncs the tickets-channel
 * message so staff see it's already resolved. */
async function handleSelfResolve(payload: InteractionPayload, action: BlockAction) {
	if (!payload.channel?.id || !payload.message?.ts) return

	let ref: Partial<TicketRef & { ticketsChannel: string; ticketsTs: string }> = {}
	try {
		ref = action.value ? JSON.parse(action.value) : {}
	} catch {
		return
	}

	if (!ref.authorId || payload.user.id !== ref.authorId) {
		if (payload.response_url) {
			await respondEphemeral(
				payload.response_url,
				'Only the person who asked can close it themselves — helpers can use "Mark as helped" right here in the thread.',
			)
		}
		return
	}

	await updateMessage(
		payload.channel.id,
		payload.message.ts,
		"Marked resolved.",
		resolveBlocks(payload.message.blocks, payload.user.id),
	)

	if (ref.ticketsChannel && ref.ticketsTs && ref.helpChannel) {
		try {
			await updateMessage(ref.ticketsChannel, ref.ticketsTs, `Ticket resolved by <@${payload.user.id}>`, [
				ticketSection(ref as TicketRef),
				...resolveBlocks(undefined, payload.user.id, "marked it themselves"),
			])
		} catch (err) {
			console.error(`Failed to sync tickets-channel message: ${err}`)
		}
	}
}

/** A helper clicking "Mark as helped" in the help-channel thread — the ask
 * from the helpers, so nobody has to jump over to the tickets channel to
 * close a ticket. Resolves both the thread ack and the tickets-channel
 * message, mirroring what the staff-side button does. */
async function handleThreadMarkHelped(payload: InteractionPayload, action: BlockAction) {
	if (!payload.channel?.id || !payload.message?.ts) return

	let ref: Partial<TicketRef & { ticketsChannel: string; ticketsTs: string }> = {}
	try {
		ref = action.value ? JSON.parse(action.value) : {}
	} catch {
		return
	}

	// The help channel is open to every participant, so the button is gated on
	// membership of the private tickets channel the bot posts to — the same
	// people who can resolve it from there.
	if (!ref.ticketsChannel || !(await isChannelMember(ref.ticketsChannel, payload.user.id))) {
		if (payload.response_url) {
			await respondEphemeral(payload.response_url, "Only the Half Life team can resolve a ticket from the thread.")
		}
		return
	}

	await updateMessage(
		payload.channel.id,
		payload.message.ts,
		`You're all set — <@${payload.user.id}> marked this as helped.`,
		resolveBlocks(payload.message.blocks, payload.user.id),
	)

	if (ref.ticketsChannel && ref.ticketsTs && ref.helpChannel) {
		try {
			await updateMessage(ref.ticketsChannel, ref.ticketsTs, `Ticket resolved by <@${payload.user.id}>`, [
				ticketSection(ref as TicketRef),
				...resolveBlocks(undefined, payload.user.id),
			])
		} catch (err) {
			console.error(`Failed to sync tickets-channel message: ${err}`)
		}
	}
}

export async function POST(request: Request) {
	const rawBody = await request.text()

	const verified = verifySlackRequest(
		rawBody,
		request.headers.get("x-slack-request-timestamp"),
		request.headers.get("x-slack-signature"),
	)
	if (!verified) {
		return NextResponse.json({ ok: false }, { status: 401 })
	}

	// Interactivity payloads arrive form-encoded with the JSON under `payload`.
	// The first thing Slack sends to a newly saved Request URL is a
	// `url_verification` challenge, and it arrives the same way.
	const form = new URLSearchParams(rawBody)
	const raw = form.get("payload") ?? (rawBody.trimStart().startsWith("{") ? rawBody : null)
	if (!raw) return NextResponse.json({ ok: false }, { status: 400 })

	let payload: InteractionPayload
	try {
		payload = JSON.parse(raw)
	} catch {
		return NextResponse.json({ ok: false }, { status: 400 })
	}

	// Slack refuses to save the interactivity Request URL unless the challenge
	// is echoed verbatim, so this has to be answered before anything else.
	if (payload.type === "url_verification") {
		return NextResponse.json({ challenge: payload.challenge })
	}

	// Slack retries an interaction it has not seen a 200 for within 3 seconds,
	// and these handlers make up to two Slack calls each. Ack first and run the
	// work in `after`, so a slow call cannot cause a duplicate resolution; the
	// same reasoning the events route uses. A retry that still arrives is
	// dropped — the original delivery was already accepted.
	if (request.headers.get("x-slack-retry-num")) {
		return NextResponse.json({ ok: true })
	}

	if (payload.type === "block_actions") {
		const action = payload.actions?.[0]
		after(async () => {
			try {
				if (action?.action_id === "mark_helped") {
					await handleMarkHelped(payload, action)
				} else if (action?.action_id === "mark_resolved_by_author") {
					await handleSelfResolve(payload, action)
				} else if (action?.action_id === "mark_helped_from_thread") {
					await handleThreadMarkHelped(payload, action)
				}
			} catch (err) {
				// The response is already sent and Slack has its 200, so the log is
				// the only trace a failure leaves.
				console.error("[slack] interaction handler threw:", err)
			}
		})
	}

	return NextResponse.json({ ok: true })
}
