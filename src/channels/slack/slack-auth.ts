/**
 * Slack authentication / app configuration.
 * The Slack App belongs to the user's workspace — HITL-MCP never owns a central bot.
 *
 * Planned flow (next milestone):
 * 1. Collect bot token + app-level token for Socket Mode
 * 2. Store credentials via CredentialStore
 * 3. Validate tokens against Slack APIs
 */

export interface SlackCredentials {
  botToken: string;
  appToken: string;
}

export async function authenticateSlack(
  _credentials: SlackCredentials,
): Promise<void> {
  throw new Error(
    "Slack authentication is not implemented yet. Use `hitl-mcp setup` with the fake channel for MVP.",
  );
}
