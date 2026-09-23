/**
 * Resolve which channel thread a tool call belongs to.
 *
 * Prefer the MCP transport session when the host provides one; otherwise use
 * this process connection id. Optional `label` is display-only.
 */

export interface SessionResolveInput {
  connectionId: string;
  label?: string;
  transportSessionId?: string;
}

export interface ResolvedSession {
  id: string;
  name?: string;
}

export function resolveSession(input: SessionResolveInput): ResolvedSession {
  const id = input.transportSessionId?.trim() || input.connectionId;
  const name = cleanLabel(input.label);
  return name ? { id, name } : { id };
}

function cleanLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
