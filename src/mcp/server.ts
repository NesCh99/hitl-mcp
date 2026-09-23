import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { HitlManager } from "../core/hitl-manager.js";
import { askHuman, AskHumanArgsSchema } from "./tools/ask-human.js";
import { notifyHuman, NotifyHumanArgsSchema } from "./tools/notify-human.js";
import { resolveSession } from "./session.js";

const TargetShape = z
  .object({
    channel: z.enum(["fake", "slack", "whatsapp"]),
    targetId: z.string(),
  })
  .optional()
  .describe("Optional per-call target override; does not change the saved default");

const LabelShape = z
  .string()
  .optional()
  .describe("Optional short label for the channel thread opener (e.g. task title)");

/**
 * MCP stdio server — progress notifications + short channel questions.
 */
export async function startMcpServer(hitl: HitlManager): Promise<void> {
  const connectionId = randomUUID();

  const server = new McpServer({
    name: "hitl-mcp",
    version: "0.1.0",
  });

  server.tool(
    "notify_human",
    "One-way progress update (start, milestones, done). Also use when something important needs a reply in the host chat. Does not wait for a reply.",
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
    "Ask a short question and wait for a brief channel reply (yes/no, A/B, one line). For long or important decisions, use notify_human and continue in the host chat.",
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
      return askHuman(hitl, connectionId, parsed, {
        id: session.id,
        name: session.name,
      });
    },
  );

  const transport = new StdioServerTransport();

  const cleanup = () => {
    hitl.onConnectionClosed(connectionId);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("beforeExit", cleanup);

  await server.connect(transport);
}
