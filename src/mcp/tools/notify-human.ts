import { z } from "zod";
import type { HitlManager } from "../../core/hitl-manager.js";
import type { Target } from "../../core/types.js";
import { TargetSchema } from "../../config/config-schema.js";
import { formatHitlError } from "./ask-human.js";

export const NotifyHumanArgsSchema = z.object({
  message: z.string().min(1),
  target: TargetSchema.optional(),
});

export type NotifyHumanArgs = z.infer<typeof NotifyHumanArgsSchema>;

/**
 * One-way notification. Does not create a pending request or wait for a reply.
 */
export async function notifyHuman(
  hitl: HitlManager,
  args: NotifyHumanArgs,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const sent = await hitl.notifyHuman({
      message: args.message,
      target: args.target as Target | undefined,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              messageId: sent.messageId,
              target: sent.target,
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
