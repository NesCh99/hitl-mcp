import { mkdir, rm } from "node:fs/promises";
import { z } from "zod";
import { getWhatsAppAuthDir } from "../../config/defaults.js";

/**
 * WhatsApp credentials are local user configuration.
 * Opaque Baileys multi-file auth lives under `authDir`.
 * Stored via CredentialStore under provider key "whatsapp".
 */
export const WhatsAppCredentialsSchema = z.object({
  /** Directory for Baileys useMultiFileAuthState (creds + keys). */
  authDir: z.string().min(1),
  /** Preferred first-time link method during setup. */
  linkMethod: z.enum(["qr", "pairing"]).optional(),
  /** Digits-only E.164 phone used for pairing-code link (no +). */
  phoneNumber: z
    .string()
    .regex(/^\d{8,15}$/, "Phone must be 8–15 digits (country code, no +)")
    .optional(),
  /** Cached linked account JID after a successful session. */
  selfJid: z.string().optional(),
  linkedAt: z.string().optional(),
});

export type WhatsAppCredentials = z.infer<typeof WhatsAppCredentialsSchema>;

export function parseWhatsAppCredentials(value: unknown): WhatsAppCredentials {
  return WhatsAppCredentialsSchema.parse(value);
}

/**
 * Strip likely session/token material from strings so it never appears in logs.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\/Users\/[^\s]+\/\.hitl-mcp\/credentials\/[^\s]+/g, "[AUTH_DIR]")
    .replace(/\\Users\\[^\s]+\\\.hitl-mcp\\credentials\\[^\s]+/g, "[AUTH_DIR]")
    .replace(/\b\d{8,15}\b/g, "[PHONE]");
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }
  return redactSecrets(String(error));
}

export async function ensureWhatsAppAuthDir(
  authDir = getWhatsAppAuthDir(),
): Promise<string> {
  await mkdir(authDir, { recursive: true, mode: 0o700 });
  return authDir;
}

/**
 * Wipe Baileys multi-file auth. Required after device_removed / logged-out,
 * and before a fresh setup link so half-dead creds are not reused.
 */
export async function clearWhatsAppAuthDir(
  authDir = getWhatsAppAuthDir(),
): Promise<void> {
  await rm(authDir, { recursive: true, force: true });
  await ensureWhatsAppAuthDir(authDir);
}
