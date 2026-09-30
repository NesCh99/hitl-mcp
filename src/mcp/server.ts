import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { HitlManager } from "../core/hitl-manager.js";
import { askHuman, AskHumanArgsSchema } from "./tools/ask-human.js";
import { notifyHuman, NotifyHumanArgsSchema } from "./tools/notify-human.js";
import {
  configureHitl,
  ConfigureHitlArgsSchema,
} from "./tools/configure-hitl.js";
import { resolveSession } from "./session.js";

const TargetShape = z
  .object({
    channel: z.enum(["fake", "slack", "whatsapp"]),
    id: z.string(),
  })
  .optional()
  .describe("Optional per-call target override");

const LabelShape = z
  .string()
  .optional()
  .describe("Optional short label for the channel thread opener");

/**
 * MCP stdio server — progress notifications + short channel questions + session prefs.
 */
export async function startMcpServer(hitl: HitlManager): Promise<void> {
  const connectionId = randomUUID();

  const server = new McpServer({
    name: "hitl-mcp",
    version: "0.1.0",
  });

  server.tool(
    "notify_human",
    "One-way progress update (start, milestones, done). Also use when something important needs a reply in the host chat. Does not wait for a reply. Soft-skips if HITL is disabled for this chat (/hitl.off).",
    {
      message: z.string().describe("The notification message"),
      label: LabelShape,
      target: TargetShape,
    },
    async (args, extra) => {
      const parsed = NotifyHumanArgsSchema.parse(args);
      const session = resolveSession({
        connectionId,
        label: parsed.label,
        transportSessionId: extra.sessionId,
      });
      return notifyHuman(hitl, parsed, { id: session.id, name: session.name });
    },
  );

  server.tool(
    "ask_human",
    "Ask a short question and wait for a brief channel reply (yes/no, A/B, one line). For long or important decisions, use notify_human and continue in the host chat. Soft-skips if HITL is disabled for this chat (/hitl.off).",
    {
      question: z.string().describe("A short question expecting a brief channel reply"),
      label: LabelShape,
      target: TargetShape,
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional HITL-side deadline. Omit to wait until the human replies."),
    },
    async (args, extra) => {
      const parsed = AskHumanArgsSchema.parse(args);
      const session = resolveSession({
        connectionId,
        label: parsed.label,
        transportSessionId: extra.sessionId,
      });
      return askHuman(
        hitl,
        connectionId,
        parsed,
        {
          id: session.id,
          name: session.name,
        },
        extra.signal,
      );
    },
  );

  server.tool(
    "configure_hitl",
    "Set per-chat HITL prefs. Call when the user types /hitl.off, /hitl.on, or /hitl-channel.<channel> (e.g. /hitl-channel.slack). Pass enabled:false for off, enabled:true for on, channel for a configured provider, or channel:null to clear back to default. Omit args to inspect current prefs.",
    {
      enabled: z
        .boolean()
        .optional()
        .describe("false = disable HITL for this chat; true = re-enable"),
      channel: z
        .enum(["fake", "slack", "whatsapp"])
        .nullable()
        .optional()
        .describe(
          'Configured provider channel (e.g. "slack"). null clears to the config default.',
        ),
      label: LabelShape,
    },
    async (args, extra) => {
      const parsed = ConfigureHitlArgsSchema.parse(args);
      const session = resolveSession({
        connectionId,
        label: parsed.label,
        transportSessionId: extra.sessionId,
      });
      return configureHitl(hitl, parsed, {
        id: session.id,
        name: session.name,
      });
    },
  );

  const transport = new StdioServerTransport();

  const cleanup = () => {
    hitl.onConnectionClosed(connectionId);
  };

  // Only clear pending asks when the MCP transport closes.
  transport.onclose = cleanup;

  await server.connect(transport);
}
