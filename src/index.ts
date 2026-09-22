#!/usr/bin/env node
import { createApp } from "./app.js";
import { runSetup } from "./cli/setup.js";
import { startMcpServer } from "./mcp/server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "setup") {
    const app = await createApp();
    await runSetup({
      configManager: app.configManager,
      channelManager: app.channelManager,
      credentialStore: app.credentialStore,
    });
    await app.channelManager.disconnectAll();
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log("0.1.0");
    return;
  }

  const app = await createApp();
  await app.loadConfig();
  app.hitl.startListening();

  const shutdown = async () => {
    await app.channelManager.disconnectAll();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("beforeExit", () => {
    void shutdown();
  });

  await startMcpServer(app.hitl);
}

function printHelp(): void {
  console.log(`hitl-mcp — local-first human-in-the-loop MCP bridge

Usage:
  hitl-mcp              Start the MCP server (stdio)
  hitl-mcp setup         Configure default channel and target
  hitl-mcp help          Show this help
  hitl-mcp version       Show version

Philosophy:
  Connect your AI agent to a conversation you already use.
  When the agent needs you, it asks there.

  HITL is an ephemeral communication bridge — not a task manager,
  messaging platform, or centralized gateway.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
