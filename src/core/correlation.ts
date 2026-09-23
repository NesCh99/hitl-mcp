import type { IncomingMessage, PendingRequest } from "./types.js";

/**
 * Correlates an incoming human message to a pending ask_human request.
 *
 * Preferred path: provider-native reply via `replyToMessageId`.
 * When multiple pending asks share the same correlation id (e.g. several
 * questions in one Slack session thread), the oldest pending request wins (FIFO).
 */
export function findMatchingPendingRequest(
  pending: ReadonlyMap<string, PendingRequest>,
  message: IncomingMessage,
): PendingRequest | undefined {
  if (!message.replyToMessageId) {
    return undefined;
  }

  let oldest: PendingRequest | undefined;
  for (const request of pending.values()) {
    if (request.outboundMessageId !== message.replyToMessageId) {
      continue;
    }
    if (!oldest || request.createdAt < oldest.createdAt) {
      oldest = request;
    }
  }
  return oldest;
}

/**
 * @deprecated Prefer findMatchingPendingRequest for FIFO-safe correlation.
 * Kept for callers that need a simple index (last-write wins).
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
  pending: ReadonlyMap<string, PendingRequest>,
  message: IncomingMessage,
): PendingRequest | undefined {
  return findMatchingPendingRequest(pending, message);
}
