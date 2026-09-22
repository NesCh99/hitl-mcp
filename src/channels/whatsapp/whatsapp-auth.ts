/**
 * WhatsApp local authentication / session.
 * Authenticates the user's own WhatsApp account — no centralized HITL identity.
 *
 * Session data may be persisted locally via CredentialStore.
 * Message history must never be stored by HITL-MCP.
 */

export interface WhatsAppSessionCredentials {
  /** Opaque session payload owned by the WhatsApp adapter. */
  sessionData: unknown;
}

export async function authenticateWhatsApp(): Promise<WhatsAppSessionCredentials> {
  throw new Error(
    "WhatsApp authentication is not implemented yet. Use `hitl-mcp setup` with the fake channel for MVP.",
  );
}
