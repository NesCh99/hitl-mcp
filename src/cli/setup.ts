import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ChannelManager } from "../channels/channel-manager.js";
import type { ConfigManager } from "../config/config-manager.js";
import type { CredentialStore } from "../auth/credential-store.js";
import type { ChannelType } from "../core/types.js";
import type { ListedTarget } from "../channels/channel-adapter.js";
import type { HitlConfig } from "../config/config-schema.js";
import { SlackCredentialsSchema } from "../channels/slack/slack-auth.js";

export interface SetupDeps {
  configManager: ConfigManager;
  channelManager: ChannelManager;
  credentialStore: CredentialStore;
}

/**
 * Interactive local setup. No HITL account, email, or password.
 * Provider-specific credential collection stays here; adapters only validate.
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

    try {
      await collectAndStoreCredentials(channel, rl, deps.credentialStore);
    } catch (error) {
      console.error(
        `Credential setup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(`\nAuthenticating ${labelFor(channel)}...`);
    try {
      await adapter.authenticate();
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
      console.error(
        "No targets discovered. For Slack, invite the bot to the channels you want to use, then re-run setup.",
      );
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

    const selected = targets[targetIndex]!;
    const defaultTarget = {
      channel: selected.channel,
      targetId: selected.targetId,
    };

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

    // Setup connected adapters for discovery; disconnect before exiting.
    await adapter.disconnect();

    console.log("\nDefault target saved.");
    console.log(`  channel:  ${defaultTarget.channel}`);
    console.log(`  targetId: ${defaultTarget.targetId}`);
    if (selected.label) {
      console.log(`  label:    ${selected.label}`);
    }
    console.log(`  config:   ${deps.configManager.getPath()}`);
    console.log("\nSetup complete. Point your MCP client at `hitl-mcp` (stdio).");
  } finally {
    rl.close();
  }
}

async function collectAndStoreCredentials(
  channel: ChannelType,
  rl: readline.Interface,
  credentialStore: CredentialStore,
): Promise<void> {
  switch (channel) {
    case "fake":
      await credentialStore.set("fake", {
        authenticatedAt: new Date().toISOString(),
      });
      return;

    case "slack": {
      console.log(`
Slack setup
-----------
Create a Slack App in your workspace with Socket Mode enabled.
You will need:
  • Bot User OAuth Token (xoxb-...)
  • App-Level Token (xapp-...) with connections:write

Tokens are stored locally under ~/.hitl-mcp/credentials/ and are never
sent to any HITL server.

Recommended bot scopes: chat:write, channels:read, groups:read,
channels:history, groups:history

Subscribe to bot events: message.channels, message.groups

Invite the bot to any channel you want to use as a HITL target.
`);

      const botToken = (await rl.question("Bot token (xoxb-...): ")).trim();
      const appToken = (
        await rl.question("App-level token (xapp-...): ")
      ).trim();

      const parsed = SlackCredentialsSchema.safeParse({ botToken, appToken });
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      }

      await credentialStore.set("slack", parsed.data);
      return;
    }

    case "whatsapp":
      throw new Error(
        "WhatsApp setup is not implemented yet. Choose Slack or Fake.",
      );

    default:
      throw new Error(`Unsupported channel: ${channel}`);
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

function formatTarget(target: ListedTarget): string {
  return target.label ?? target.targetId;
}
