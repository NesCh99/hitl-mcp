import { z } from "zod";
import type { HitlManager } from "../../core/hitl-manager.js";
import type { SessionRef } from "../../core/types.js";
import { ChannelTypeSchema } from "../../config/config-schema.js";
import { formatHitlError } from "./ask-human.js";

export const ConfigureHitlArgsSchema = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe("false = /hitl.off (soft skip ask/notify); true = /hitl.on"),
  channel: ChannelTypeSchema.nullable()
    .optional()
    .describe(
      'Provider channel from config (e.g. "slack"). null clears to config default. Maps from /hitl-channel.<channel>',
    ),
  label: z.string().optional(),
});

export type ConfigureHitlArgs = z.infer<typeof ConfigureHitlArgsSchema>;

/**
 * Per-chat HITL prefs (ephemeral). Driven by user slash commands in the host chat.
 */
export function configureHitl(
  hitl: HitlManager,
  args: ConfigureHitlArgs,
  session: SessionRef,
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  try {
    if (args.enabled === undefined && args.channel === undefined) {
      const prefs = hitl.getSessionPrefs(session.id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                sessionId: session.id,
                prefs,
                channels: hitl.listTargetChannels(),
                hint: "Pass enabled and/or channel to change prefs.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const prefs = hitl.configureSession(session.id, {
      enabled: args.enabled,
      channel: args.channel,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              sessionId: session.id,
              prefs,
              channels: hitl.listTargetChannels(),
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
