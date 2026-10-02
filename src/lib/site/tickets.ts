import { deleteMessage, type SlackBlock } from "./slack"

/**
 * Everything either button (the staff-facing one in the tickets channel, or
 * the self-resolve one in the #halflife-help thread) needs to act — carried
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
				text: `✅ Helped by <@${byUserId}>${note ? ` — ${note}` : ""}`,
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
 * The record isn't lost: the `#halflife-help` thread keeps the question and
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
