import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ChannelManager } from "../channels/channel-manager.js";
import type { ConfigManager } from "../config/config-manager.js";
import type { CredentialStore } from "../auth/credential-store.js";
import type { ChannelType, Target } from "../core/types.js";
import type { HitlConfig } from "../config/config-schema.js";

export interface SetupDeps {
  configManager: ConfigManager;
  channelManager: ChannelManager;
  credentialStore: CredentialStore;
}

/**
 * Interactive local setup. No HITL account, email, or password.
 */
export async function runSetup(deps: SetupDeps): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    const existing = await deps.configManager.exists();
    if (existing) {
      console.log(`Existing configuration found at ${deps.configManager.getPath()}`);
      console.log("You can update the default target or configure another provider.\n");
    } else {
      console.log("Welcome to HITL-MCP setup.\n");
      console.log(
        "This configures a local communication bridge. No HITL account is created.\n",
      );
    }

    const available = deps.channelManager.listTypes();
    console.log("Select your default communication channel:\n");
    available.forEach((type, index) => {
      console.log(`  ${index + 1}. ${labelFor(type)}`);
    });
    console.log();

    const choice = await rl.question(`Enter number [1-${available.length}]: `);
    const index = Number.parseInt(choice.trim(), 10) - 1;
    if (Number.isNaN(index) || index < 0 || index >= available.length) {
      console.error("Invalid selection.");
      process.exitCode = 1;
      return;
    }

    const channel = available[index]!;
    const adapter = deps.channelManager.getAdapter(channel);

    console.log(`\nAuthenticating ${labelFor(channel)}...`);
    try {
      await adapter.authenticate();
      // Mark provider as configured in credential store (opaque flag for MVP fake).
      await deps.credentialStore.set(channel, {
        authenticatedAt: new Date().toISOString(),
      });
      console.log("Authentication successful.\n");
    } catch (error) {
      console.error(
        `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
      return;
    }

    await adapter.connect();
    const targets = await adapter.listTargets();
    if (targets.length === 0) {
      console.error("No targets discovered for this channel.");
      process.exitCode = 1;
      return;
    }

    console.log("Select your default target:\n");
    targets.forEach((target, i) => {
      console.log(`  ${i + 1}. ${formatTarget(target)}`);
    });
    console.log();

    const targetChoice = await rl.question(`Enter number [1-${targets.length}]: `);
    const targetIndex = Number.parseInt(targetChoice.trim(), 10) - 1;
    if (
      Number.isNaN(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= targets.length
    ) {
      console.error("Invalid selection.");
      process.exitCode = 1;
      return;
    }

    const defaultTarget = targets[targetIndex]!;
    const config = await deps.configManager.load();
    const next: HitlConfig = {
      ...config,
      defaultTarget,
      channels: {
        ...config.channels,
        [channel]: {
          ...(config.channels[channel as keyof typeof config.channels] ?? {}),
          enabled: true,
        },
      },
    };

    await deps.configManager.save(next);
    console.log("\nDefault target saved.");
    console.log(`  channel:  ${defaultTarget.channel}`);
    console.log(`  targetId: ${defaultTarget.targetId}`);
    console.log(`  config:   ${deps.configManager.getPath()}`);
    console.log("\nSetup complete. Point your MCP client at `hitl-mcp` (stdio).");
  } finally {
    rl.close();
  }
}

function labelFor(type: ChannelType): string {
  switch (type) {
    case "fake":
      return "Fake (development / testing)";
    case "slack":
      return "Slack";
    case "whatsapp":
      return "WhatsApp";
    default:
      return type;
  }
}

function formatTarget(target: Target): string {
  return `${target.targetId}`;
}
