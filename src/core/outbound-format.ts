/** Markdown mark so channel peers can tell HITL traffic apart from a human. */
const HITL_ASSISTANT_PREFIX = "**assistant** ";

/**
 * Prefix outbound HITL text for every channel.
 * Idempotent if the prefix is already present.
 */
export function formatHitlOutbound(text: string): string {
  const trimmed = text.trimStart();
  if (trimmed.toLowerCase().startsWith("**assistant**")) {
    return text;
  }
  return `${HITL_ASSISTANT_PREFIX}${text}`;
}
