import { deleteMessage, type SlackBlock } from "./slack"

/**
 * Everything either button (the staff-facing one in the tickets channel, or
 * the self-resolve one in the #half-life-help thread) needs to act — carried
 * in the button's own `value` since there's no ticket database to look it
 * up from.
 */
export type TicketRef = {
	helpChannel: string
	helpTs: string
	authorId: string
	/** null when the permalink lookup failed — the ticket still posts, just
	 * without a jump link. */
	permalink: string | null
}

export const TICKET_ACTIONS_BLOCK_ID = "ticket_actions"
export const SELF_RESOLVE_ACTIONS_BLOCK_ID = "self_resolve_actions"

/**
 * Everything the bot says to a participant, in one place so the voice stays
 * one voice.
 *
 * The register is the one the other event bots used in this workspace (see
 * `botexamples.md`): lowercase, contractions, an emoji to open, bullets when
 * there's more than one thing to say, and a first-person narrator who is
 * clearly a cat and is not the one doing the actual helping. Warm, a bit
 * distracted, never institutional — the participant is reading this in a
 * channel where they've just asked for help, and "your ticket has been
 * flagged to the helpers" is the wrong register for that moment.
 *
 * Two things are deliberately *not* here: the tickets channel's own strings,
 * which are read by staff rather than participants, and anything the FAQ card
 * already says.
 */
export const HELP_THREAD_REMINDERS = `:yay-wave: hi there! i'm keeping an eye on this thread while you wait. a few things in the meantime:
• have a read of the faq below – there's a fair chance your question's already answered in there!
• if it's about your own build, like wiring something up or picking a part, just say so and one of the hardware experts will dig in with you.
• once your question's been answered, hit a button below and i'll head off :D`

export const FAQ_CARD_TITLE = "the faq, just in case"

export const FAQ_CARD_BUTTON = "read the faq"

export const SELF_RESOLVE_BUTTON = "i've got it, thanks"

export const MARK_HELPED_BUTTON = "mark as helped"

/** The workspace's custom "done" emoji, dropped on the original question once
 * its ticket is resolved from any of the three buttons. Note this is the
 * hyphenated custom-emoji name, not `:white_check_mark:` — it only resolves if
 * an emoji by this exact name exists in the Hack Club workspace. */
export const RESOLVED_REACTION = "white-checkbox-checkbox-checkbox"

/** Posted to the thread once a helper has answered. Mentions the helper on
 * purpose: for them the participant hasn't had an answer yet, so this is the
 * ping that tells them it's arrived. */
export function helpedAck(helperId: string): string {
	return `oh! <@${helperId}> has this one sorted – you're all set! if anything else comes up, just send another message in #half-life-help and someone'll pick it up :D`
}

/** The same beat for the author resolving their own ticket, with no mention —
 * they'd be pinging themselves over their own click. */
export function selfResolvedAck(): string {
	return "oh! you've marked this as resolved – thanks for letting us know! if you need anything else, just send another message in #half-life-help and someone'll be happy to help :D"
}

/** Links to the original rather than copying it: a quoted copy can't be
 * replied to, so the useful thing to hand a helper is a jump link into the
 * thread. The permalink also rides in the message's top-level `text` (Slack
 * only unfurls links there, never inside blocks) so it previews the original
 * message where unfurling is available. */
export function ticketSection(ref: TicketRef): SlackBlock {
	return {
		type: "section",
		text: {
			type: "mrkdwn",
			text: ref.permalink
				? `*Ticket* from <@${ref.authorId}> in <#${ref.helpChannel}> — <${ref.permalink}|open the thread>`
				: `*Ticket* from <@${ref.authorId}> in <#${ref.helpChannel}>`,
		},
	}
}

export function resolvedContext(byUserId: string, note?: string): SlackBlock {
	return {
		type: "context",
		elements: [
			{
				type: "mrkdwn",
				text: `✅ helped by <@${byUserId}>${note ? ` – ${note}` : ""}`,
			},
		],
	}
}

/** Strips whichever action block is present and appends a resolved note —
 * shared by both buttons since a message only ever carries one of the two. */
export function resolveBlocks(blocks: SlackBlock[] | undefined, byUserId: string, note?: string): SlackBlock[] {
	const kept = (blocks ?? []).filter(
		(block) => block.block_id !== TICKET_ACTIONS_BLOCK_ID && block.block_id !== SELF_RESOLVE_ACTIONS_BLOCK_ID,
	)
	kept.push(resolvedContext(byUserId, note))
	return kept
}

/**
 * Takes a resolved ticket's mirror out of the tickets channel, and reports
 * whether it's actually gone.
 *
 * The channel is a queue: a ticket that arrives there wants help, and one
 * that's answered has nothing left to ask. Deleting rather than striking
 * through keeps the queue honest, and it's safe because the mirror is a
 * message the bot posted itself — `chat.delete` needs no extra scope for it.
 * The record isn't lost: the `#half-life-help` thread keeps the question and
 * the "you're all set" ack, which is where anyone would go looking.
 *
 * False means the removal didn't land, and is the caller's cue to fall back to
 * editing the message into its resolved state. A ticket must never be left
 * sitting in the queue with a live button just because the delete failed, so
 * the fallback is a floor on reliability, not a nicety. `message_not_found`
 * counts as gone — a ticket can be resolved from either the tickets channel or
 * the help thread, so the second arrival is told the message is already gone,
 * which is the outcome we wanted.
 */
export async function deleteTicketMessage(channel: string, ts: string): Promise<boolean> {
	const result = await deleteMessage(channel, ts)
	return result.ok || result.error === "message_not_found"
}
