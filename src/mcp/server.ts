import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { HitlManager } from "../core/hitl-manager.js";
import { askHuman, AskHumanArgsSchema } from "./tools/ask-human.js";
import { notifyHuman, NotifyHumanArgsSchema } from "./tools/notify-human.js";

/**
 * MCP stdio server. One process may host one stdio connection for the MVP.
 * connectionId scopes pending requests so future multi-connection hosts
 * can isolate ask_human promises correctly.
 */
export async function startMcpServer(hitl: HitlManager): Promise<void> {
  const connectionId = randomUUID();

  const server = new McpServer({
    name: "hitl-mcp",
    version: "0.1.0",
  });

  server.tool(
    "ask_human",
    "Send a question to the human via their configured communication channel and wait for a reply. Uses the default target unless an explicit target override is provided. Nothing is persisted.",
    {
      question: z.string().describe("The question to ask the human"),
      target: z
        .object({
          channel: z.enum(["fake", "slack", "whatsapp"]),
          targetId: z.string(),
        })
        .optional()
        .describe("Optional per-call target override; does not change the saved default"),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional timeout in milliseconds (default: 5 minutes)"),
    },
    async (args) => {
      const parsed = AskHumanArgsSchema.parse(args);
      return askHuman(hitl, connectionId, parsed);
    },
  );

  server.tool(
    "notify_human",
    "Send a one-way notification to the human. Does not wait for a response. Nothing is persisted.",
    {
      message: z.string().describe("The notification message"),
      target: z
        .object({
          channel: z.enum(["fake", "slack", "whatsapp"]),
          targetId: z.string(),
        })
        .optional()
        .describe("Optional per-call target override; does not change the saved default"),
    },
    async (args) => {
      const parsed = NotifyHumanArgsSchema.parse(args);
      return notifyHuman(hitl, parsed);
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
