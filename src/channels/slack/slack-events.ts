import type { IncomingMessage } from "../../core/types.js";

/**
 * Map Slack events into normalized IncomingMessage.
 * Slack concepts (thread_ts, channel, user) must not leak into the core.
 */

export interface SlackMessageEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  /** Present on thread replies; equals the parent message ts. */
  thread_ts?: string;
  /** Hidden/edited/etc. — ignore non-user message traffic. */
  hidden?: boolean;
}

export interface MapSlackEventOptions {
  /** Ignore messages authored by this bot user id. */
  botUserId?: string;
}

/**
 * Convert a Slack message event into IncomingMessage, or undefined if it
 * should not participate in HITL correlation (bots, edits, empty text, etc.).
 *
 * Reply correlation: thread replies set `replyToMessageId` to `thread_ts`,
 * which matches the outbound root message `ts` stored as `messageId`.
 */
export function mapSlackEventToIncoming(
  event: SlackMessageEvent,
  options: MapSlackEventOptions = {},
): IncomingMessage | undefined {
  if (event.type !== undefined && event.type !== "message") {
    return undefined;
  }

  // Ignore edits, deletes, bot messages, joins, etc.
  if (event.subtype) {
    return undefined;
  }

  if (event.hidden) {
    return undefined;
  }

  if (event.bot_id) {
    return undefined;
  }

  if (!event.channel || !event.ts || !event.user) {
    return undefined;
  }

  if (options.botUserId && event.user === options.botUserId) {
    return undefined;
  }

  const text = event.text?.trim();
  if (!text) {
    return undefined;
  }

  // Root messages have no thread_ts (or thread_ts === ts).
  // Thread replies have thread_ts pointing at the parent — use that for correlation.
  const isThreadReply =
    typeof event.thread_ts === "string" &&
    event.thread_ts.length > 0 &&
    event.thread_ts !== event.ts;

  return {
    channel: "slack",
    targetId: event.channel,
    messageId: event.ts,
    replyToMessageId: isThreadReply ? event.thread_ts : undefined,
    senderId: event.user,
    text,
  };
}
