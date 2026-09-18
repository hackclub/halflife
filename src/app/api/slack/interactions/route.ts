import { NextResponse } from "next/server";
import {
  postMessage,
  updateMessage,
  verifySlackRequest,
  type SlackBlock,
} from "@/lib/slack";
import { resolveBlocks, ticketSection, type TicketRef } from "@/lib/tickets";

export const runtime = "nodejs";

type BlockAction = {
  action_id: string;
  value?: string;
};

type InteractionPayload = {
  type: string;
  user: { id: string };
  channel?: { id: string };
  message?: { ts: string; blocks?: SlackBlock[] };
  actions?: BlockAction[];
  response_url?: string;
};

async function respondEphemeral(responseUrl: string, text: string) {
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", text }),
    });
  } catch (err) {
    console.error(`Failed to post ephemeral response: ${err}`);
  }
}

/** Staff clicking "Mark as helped" in the tickets channel — no permission
 * check, anyone with access to that private channel can resolve a ticket. */
async function handleMarkHelped(payload: InteractionPayload, action: BlockAction) {
  if (!payload.channel?.id || !payload.message?.ts) return;

  let ref: Partial<TicketRef> = {};
  try {
    ref = action.value ? JSON.parse(action.value) : {};
  } catch {
    // Malformed value — still resolve the tickets-channel message below.
  }

  await updateMessage(
    payload.channel.id,
    payload.message.ts,
    `Ticket resolved by <@${payload.user.id}>`,
    resolveBlocks(payload.message.blocks, payload.user.id),
  );

  if (ref.helpChannel && ref.helpTs) {
    try {
      await postMessage(
        ref.helpChannel,
        `You're all set — <@${payload.user.id}> marked this as helped.`,
        { threadTs: ref.helpTs },
      );
    } catch (err) {
      console.error(`Failed to post help-channel ack: ${err}`);
    }
  }
}

/** The ticket's own author clicking "I'm all set" in the help-channel
 * thread — restricted to whoever opened the ticket, so someone else in the
 * thread can't close it out from under them. Also syncs the tickets-channel
 * message so staff see it's already resolved. */
async function handleSelfResolve(payload: InteractionPayload, action: BlockAction) {
  if (!payload.channel?.id || !payload.message?.ts) return;

  let ref: Partial<TicketRef & { ticketsChannel: string; ticketsTs: string }> = {};
  try {
    ref = action.value ? JSON.parse(action.value) : {};
  } catch {
    return;
  }

  if (!ref.authorId || payload.user.id !== ref.authorId) {
    if (payload.response_url) {
      await respondEphemeral(
        payload.response_url,
        "Only the person who asked can close it themselves — helpers can use \"Mark as helped\" right here in the thread.",
      );
    }
    return;
  }

  await updateMessage(
    payload.channel.id,
    payload.message.ts,
    "Marked resolved.",
    resolveBlocks(payload.message.blocks, payload.user.id),
  );

  if (ref.ticketsChannel && ref.ticketsTs && ref.helpChannel) {
    try {
      await updateMessage(
        ref.ticketsChannel,
        ref.ticketsTs,
        `Ticket resolved by <@${payload.user.id}>`,
        [
          ticketSection(ref as TicketRef),
          ...resolveBlocks(undefined, payload.user.id, "marked it themselves"),
        ],
      );
    } catch (err) {
      console.error(`Failed to sync tickets-channel message: ${err}`);
    }
  }
}

/** A helper clicking "Mark as helped" in the help-channel thread — the ask
 * from the helpers, so nobody has to jump over to the tickets channel to
 * close a ticket. Resolves both the thread ack and the tickets-channel
 * message, mirroring what the staff-side button does. */
async function handleThreadMarkHelped(payload: InteractionPayload, action: BlockAction) {
  if (!payload.channel?.id || !payload.message?.ts) return;

  let ref: Partial<TicketRef & { ticketsChannel: string; ticketsTs: string }> = {};
  try {
    ref = action.value ? JSON.parse(action.value) : {};
  } catch {
    return;
  }

  await updateMessage(
    payload.channel.id,
    payload.message.ts,
    `You're all set — <@${payload.user.id}> marked this as helped.`,
    resolveBlocks(payload.message.blocks, payload.user.id),
  );

  if (ref.ticketsChannel && ref.ticketsTs && ref.helpChannel) {
    try {
      await updateMessage(
        ref.ticketsChannel,
        ref.ticketsTs,
        `Ticket resolved by <@${payload.user.id}>`,
        [
          ticketSection(ref as TicketRef),
          ...resolveBlocks(undefined, payload.user.id),
        ],
      );
    } catch (err) {
      console.error(`Failed to sync tickets-channel message: ${err}`);
    }
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  const verified = verifySlackRequest(
    rawBody,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"),
  );
  if (!verified) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Interactivity payloads arrive form-encoded with the JSON under `payload`.
  const form = new URLSearchParams(rawBody);
  const raw = form.get("payload");
  if (!raw) return NextResponse.json({ ok: false }, { status: 400 });

  let payload: InteractionPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (action?.action_id === "mark_helped") {
      await handleMarkHelped(payload, action);
    } else if (action?.action_id === "mark_resolved_by_author") {
      await handleSelfResolve(payload, action);
    } else if (action?.action_id === "mark_helped_from_thread") {
      await handleThreadMarkHelped(payload, action);
    }
  }

  return NextResponse.json({ ok: true });
}
