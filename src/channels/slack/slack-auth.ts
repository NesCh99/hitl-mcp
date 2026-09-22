import { z } from "zod";

/**
 * Slack credentials are local user configuration — never runtime HITL state.
 * Stored via CredentialStore under provider key "slack".
 */
export const SlackCredentialsSchema = z.object({
  botToken: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("xoxb-"), {
      message: "Bot token must start with xoxb-",
    }),
  appToken: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("xapp-"), {
      message: "App-level token must start with xapp-",
    }),
  /** Cached from auth.test — used to ignore the bot's own messages. */
  botUserId: z.string().optional(),
  teamId: z.string().optional(),
  teamName: z.string().optional(),
});

export type SlackCredentials = z.infer<typeof SlackCredentialsSchema>;

export function parseSlackCredentials(value: unknown): SlackCredentials {
  return SlackCredentialsSchema.parse(value);
}

/**
 * Strip Slack tokens from strings so they never appear in logs or agent errors.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/xoxb-[A-Za-z0-9-]+/g, "xoxb-[REDACTED]")
    .replace(/xapp-[A-Za-z0-9-]+/g, "xapp-[REDACTED]");
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }
  return redactSecrets(String(error));
}
