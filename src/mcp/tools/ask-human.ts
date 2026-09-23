import { z } from "zod";
import type { HitlManager } from "../../core/hitl-manager.js";
import { HitlError, type SessionRef, type Target } from "../../core/types.js";
import { TargetSchema } from "../../config/config-schema.js";

export const AskHumanArgsSchema = z.object({
  question: z.string().min(1),
  label: z.string().optional(),
  target: TargetSchema.optional(),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional deadline in milliseconds. Omit to wait indefinitely until the human replies (or the MCP connection closes).",
    ),
});

export type AskHumanArgs = z.infer<typeof AskHumanArgsSchema>;

export function formatHitlError(error: unknown): string {
  if (error instanceof HitlError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Short channel question with a brief reply. Not for long / high-stakes decisions.
 * Session/thread identity is supplied by the MCP layer (not the agent).
 */
export async function askHuman(
  hitl: HitlManager,
  connectionId: string,
  args: AskHumanArgs,
  session: SessionRef,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await hitl.askHuman({
      question: args.question,
      connectionId,
      session,
      target: args.target as Target | undefined,
      timeoutMs: args.timeoutMs,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              requestId: result.requestId,
              response: result.response.text,
              senderId: result.response.senderId,
              messageId: result.response.messageId,
              target: {
                channel: result.response.channel,
                targetId: result.response.targetId,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: formatHitlError(error) }],
    };
  }
}
