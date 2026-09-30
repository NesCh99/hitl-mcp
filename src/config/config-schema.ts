import { z } from "zod";

export const ChannelTypeSchema = z.enum(["fake", "slack", "whatsapp"]);

/** Explicit destination (tool override / resolved send target). */
export const TargetSchema = z.object({
  channel: ChannelTypeSchema,
  id: z.string().min(1),
});

/**
 * A configured destination — one per provider channel for now.
 * `/hitl-channel.<channel>` selects by `channel` (slack / whatsapp / fake).
 */
export const ConfiguredTargetSchema = z.object({
  channel: ChannelTypeSchema,
  id: z.string().min(1),
  /** Display only: WhatsApp group title or Slack #channel. */
  label: z.string().min(1).optional(),
});

export const SlackConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    /** Non-secret Slack preferences only. Tokens live in CredentialStore. */
    teamId: z.string().optional(),
    teamName: z.string().optional(),
  })
  .passthrough();

export const WhatsAppConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .passthrough();

export const FakeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    targets: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

/**
 * HITL preferences.
 *
 * - `targets`: at most one entry per `channel`
 * - `defaultTarget`: which channel to use when the chat has not selected another
 */
export const HitlConfigSchema = z
  .object({
    defaultTarget: ChannelTypeSchema.optional(),
    targets: z.array(ConfiguredTargetSchema).default([]),
    channels: z
      .object({
        fake: FakeConfigSchema.optional(),
        slack: SlackConfigSchema.optional(),
        whatsapp: WhatsAppConfigSchema.optional(),
      })
      .default({}),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    for (const target of config.targets) {
      if (seen.has(target.channel)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate target for channel "${target.channel}". Only one destination per channel is supported.`,
          path: ["targets"],
        });
      }
      seen.add(target.channel);
    }
  });

export type HitlConfig = z.infer<typeof HitlConfigSchema>;
export type SlackConfig = z.infer<typeof SlackConfigSchema>;
export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;
export type FakeConfig = z.infer<typeof FakeConfigSchema>;
export type TargetConfig = z.infer<typeof TargetSchema>;
export type ConfiguredTarget = z.infer<typeof ConfiguredTargetSchema>;
export type ChannelTypeConfig = z.infer<typeof ChannelTypeSchema>;
