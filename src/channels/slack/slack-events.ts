import type { IncomingMessage } from "../../core/types.js";

/**
 * Map Slack events into normalized IncomingMessage.
 * Slack concepts (thread_ts, channel, user) must not leak into the core.
 */

export interface SlackMessageEvent {
  type: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
}

export function mapSlackEventToIncoming(
  event: SlackMessageEvent,
): IncomingMessage | undefined {
  if (event.type !== "message" || !event.text) {
    return undefined;
  }

  return {
    channel: "slack",
    targetId: event.channel,
    messageId: event.ts,
    // Slack replies in a thread reference the parent via thread_ts.
    replyToMessageId: event.thread_ts,
    senderId: event.user,
    text: event.text,
  };
}
