/** Slack mrkdwn + WhatsApp both use single-asterisk bold. */
const ASSISTANT_PREFIX = "*assistant* ";

/**
 * Prefix outbound HITL text so channel peers can tell it apart from a human.
 * Idempotent if an assistant prefix is already present.
 */
export function formatHitlOutbound(text: string): string {
  const trimmed = text.trimStart();
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("*assistant*") ||
    lower.startsWith("**assistant**") ||
    lower.startsWith("_assistant_")
  ) {
    return text;
  }
  return `${ASSISTANT_PREFIX}${text}`;
}
