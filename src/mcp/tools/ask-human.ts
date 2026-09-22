import { z } from "zod";
import type { HitlManager } from "../../core/hitl-manager.js";
import { HitlError, type Target } from "../../core/types.js";
import { TargetSchema } from "../../config/config-schema.js";

export const AskHumanArgsSchema = z.object({
  question: z.string().min(1),
  target: TargetSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
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
 * Send a question to the human and wait for a response.
 * Nothing from this interaction is persisted.
 */
export async function askHuman(
  hitl: HitlManager,
  connectionId: string,
  args: AskHumanArgs,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await hitl.askHuman({
      question: args.question,
      connectionId,
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
