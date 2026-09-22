import type { IncomingMessage, PendingRequest } from "./types.js";

/**
 * Correlates an incoming human message to a pending ask_human request.
 *
 * Preferred path: provider-native reply via `replyToMessageId`.
 * Fallback codes and provider-specific tricks stay inside adapters;
 * this module only works with normalized IDs.
 */
export function findMatchingPendingRequest(
  pending: ReadonlyMap<string, PendingRequest>,
  message: IncomingMessage,
): PendingRequest | undefined {
  if (message.replyToMessageId) {
    for (const request of pending.values()) {
      if (request.outboundMessageId === message.replyToMessageId) {
        return request;
      }
    }
  }

  return undefined;
}

/**
 * Index pending requests by outbound message ID for O(1) reply correlation.
 */
export function indexByOutboundMessageId(
  pending: ReadonlyMap<string, PendingRequest>,
): Map<string, PendingRequest> {
  const index = new Map<string, PendingRequest>();
  for (const request of pending.values()) {
    index.set(request.outboundMessageId, request);
  }
  return index;
}

export function correlateByReply(
  byOutboundId: ReadonlyMap<string, PendingRequest>,
  message: IncomingMessage,
): PendingRequest | undefined {
  if (!message.replyToMessageId) {
    return undefined;
  }
  return byOutboundId.get(message.replyToMessageId);
}
