import { z } from "zod";
import type { HitlManager } from "../../core/hitl-manager.js";
import type { SessionRef, Target } from "../../core/types.js";
import { TargetSchema } from "../../config/config-schema.js";
import { formatHitlError } from "./ask-human.js";

export const NotifyHumanArgsSchema = z.object({
  message: z.string().min(1),
  label: z.string().optional(),
  target: TargetSchema.optional(),
});

export type NotifyHumanArgs = z.infer<typeof NotifyHumanArgsSchema>;

/**
 * Progress / awareness ping. Does not wait for a reply.
 * Session/thread identity is supplied by the MCP layer (not the agent).
 */
export async function notifyHuman(
  hitl: HitlManager,
  args: NotifyHumanArgs,
  session: SessionRef,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await hitl.notifyHuman({
      message: args.message,
      session,
      target: args.target as Target | undefined,
    });

    if (result.kind === "skipped") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                skipped: true,
                reason: result.reason,
                message: result.message,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              messageId: result.message.messageId,
              correlationId: result.message.correlationId,
              target: result.message.target,
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
