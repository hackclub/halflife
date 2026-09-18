import type { SlackBlock } from "./slack";

/**
 * Everything either button (the staff-facing one in the tickets channel, or
 * the self-resolve one in the #halflife-help thread) needs to act — carried
 * in the button's own `value` since there's no ticket database to look it
 * up from.
 */
export type TicketRef = {
  helpChannel: string;
  helpTs: string;
  authorId: string;
  /** null when the permalink lookup failed — the ticket still posts, just
   * without a jump link. */
  permalink: string | null;
};

export const TICKET_ACTIONS_BLOCK_ID = "ticket_actions";
export const SELF_RESOLVE_ACTIONS_BLOCK_ID = "self_resolve_actions";

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
  };
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
  };
}

/** Strips whichever action block is present and appends a resolved note —
 * shared by both buttons since a message only ever carries one of the two. */
export function resolveBlocks(
  blocks: SlackBlock[] | undefined,
  byUserId: string,
  note?: string,
): SlackBlock[] {
  const kept = (blocks ?? []).filter(
    (block) =>
      block.block_id !== TICKET_ACTIONS_BLOCK_ID &&
      block.block_id !== SELF_RESOLVE_ACTIONS_BLOCK_ID,
  );
  kept.push(resolvedContext(byUserId, note));
  return kept;
}
