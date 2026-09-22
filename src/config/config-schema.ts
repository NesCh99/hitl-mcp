import { z } from "zod";

export const ChannelTypeSchema = z.enum(["fake", "slack", "whatsapp"]);

export const TargetSchema = z.object({
  channel: ChannelTypeSchema,
  targetId: z.string().min(1),
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
          targetId: z.string().min(1),
          label: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export const HitlConfigSchema = z.object({
  defaultTarget: TargetSchema.optional(),
  channels: z
    .object({
      fake: FakeConfigSchema.optional(),
      slack: SlackConfigSchema.optional(),
      whatsapp: WhatsAppConfigSchema.optional(),
    })
    .default({}),
});

export type HitlConfig = z.infer<typeof HitlConfigSchema>;
export type SlackConfig = z.infer<typeof SlackConfigSchema>;
export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;
export type FakeConfig = z.infer<typeof FakeConfigSchema>;
