import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ChannelManager } from "../channels/channel-manager.js";
import type { ConfigManager } from "../config/config-manager.js";
import type { CredentialStore } from "../auth/credential-store.js";
import type { ChannelType } from "../core/types.js";
import type { ListedTarget } from "../channels/channel-adapter.js";
import type { HitlConfig } from "../config/config-schema.js";
import { SlackCredentialsSchema } from "../channels/slack/slack-auth.js";
import {
  clearWhatsAppAuthDir,
  ensureWhatsAppAuthDir,
  WhatsAppCredentialsSchema,
} from "../channels/whatsapp/whatsapp-auth.js";
import { WhatsAppAdapter } from "../channels/whatsapp/whatsapp-adapter.js";
import {
  defaultSetupPhrase,
  formatListedTarget,
} from "../channels/whatsapp/whatsapp-setup.js";
import { getWhatsAppAuthDir } from "../config/defaults.js";

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

    console.log(
      channel === "whatsapp"
        ? "\nConnecting WhatsApp (scan QR / enter pairing code if prompted)...\n"
        : "",
    );
    await adapter.connect();

    // WhatsApp chat lists fill in asynchronously after link.
    let targets = await adapter.listTargets();
    if (channel === "whatsapp" && targets.length === 0) {
      console.log("Waiting a few seconds for chats to sync...");
      await sleep(4000);
      targets = await adapter.listTargets();
    }

    if (channel === "whatsapp" && adapter instanceof WhatsAppAdapter) {
      const invalidated = await adapter.takeSessionInvalidationError();
      if (invalidated) {
        console.error(invalidated.message);
        process.exitCode = 1;
        return;
      }
      if (!adapter.isConnected()) {
        console.error(
          "WhatsApp disconnected during setup before targets could be listed. Re-run setup and scan again (only one HITL process should use this session).",
        );
        process.exitCode = 1;
        return;
      }
    }

    let selected: ListedTarget;

    if (channel === "whatsapp") {
      try {
        if (!(adapter instanceof WhatsAppAdapter)) {
          throw new Error("WhatsApp adapter is not available.");
        }
        selected = await selectWhatsAppTarget(rl, adapter, targets);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }
    } else if (targets.length === 0) {
      console.error(
        "No targets discovered. For Slack, invite the bot to the channels you want to use, then re-run setup.",
      );
      process.exitCode = 1;
      return;
    } else {
      console.log("Select your default target:\n");
      targets.forEach((target, i) => {
        console.log(`  ${i + 1}. ${formatTarget(target)}`);
      });
      console.log();

      const targetChoice = await rl.question(
        `Enter number [1-${targets.length}]: `,
      );
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
      selected = targets[targetIndex]!;
    }

    try {
      console.log(
        `\nSending a test greeting to ${formatTarget(selected)}...`,
      );
      await adapter.sendPlainMessage(
        selected.targetId,
        "Hi — your channel is connected and ready.",
      );
      // Give Baileys a moment to flush the ciphertext before we tear down the
      // socket — otherwise setup can exit before the greeting is delivered.
      await sleep(2000);
      console.log("Greeting sent — check your channel to confirm it arrived.");
    } catch (error) {
      console.error(
        `Could not send greeting: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
      return;
    }

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

    case "whatsapp": {
      console.log(`
WhatsApp setup
--------------
HITL links your own WhatsApp account as a multi-device companion on this
machine (Baileys). There is no HITL cloud account and no Meta Business API.

Important:
  • This uses an unofficial WhatsApp Web client library (ToS risk).
  • Prefer a non-primary number for experimentation.
  • Only the local session is stored — never message history.

Session files go under ~/.hitl-mcp/credentials/whatsapp-auth/
`);

      const methodRaw = (
        await rl.question("Link method — qr or pairing [qr]: ")
      )
        .trim()
        .toLowerCase();
      const linkMethod =
        methodRaw === "pairing" || methodRaw === "p" ? "pairing" : "qr";

      let phoneNumber: string | undefined;
      if (linkMethod === "pairing") {
        phoneNumber = (
          await rl.question(
            "Phone number with country code, digits only (e.g. 15551234567): ",
          )
        )
          .trim()
          .replace(/[^\d]/g, "");
      }

      const authDir = getWhatsAppAuthDir();
      console.log("Clearing any previous local WhatsApp session files...");
      await clearWhatsAppAuthDir(authDir);
      await ensureWhatsAppAuthDir(authDir);

      const parsed = WhatsAppCredentialsSchema.safeParse({
        authDir,
        linkMethod,
        ...(phoneNumber ? { phoneNumber } : {}),
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      }

      await credentialStore.set("whatsapp", parsed.data);

      if (linkMethod === "qr") {
        console.log(
          "\nA QR code will appear when connecting. Scan it in WhatsApp → Linked Devices.",
        );
        console.log(
          "On your phone, remove any old \"HITL\" / Chrome linked devices first if present.\n",
        );
      } else {
        console.log(
          "\nAfter WhatsApp connects, wait a few seconds for the pairing code.",
        );
        console.log(
          "On your phone: Linked Devices → Link a device → Link with phone number instead\n",
        );
      }
      return;
    }

    default:
      throw new Error(`Unsupported channel: ${channel}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function selectWhatsAppTarget(
  rl: readline.Interface,
  adapter: WhatsAppAdapter,
  _discovered: ListedTarget[],
): Promise<ListedTarget> {
  const phrase = defaultSetupPhrase();
  const phraseDisplay = phrase
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  const myAccount = adapter.getMyAccountTarget();

  console.log("How do you want to choose the WhatsApp target?\n");
  if (myAccount) {
    console.log(`  1. Use my account — ${formatListedTarget(myAccount)}`);
  } else {
    console.log("  1. Use my account");
  }
  console.log(
    "  2. Paste a group invite link (admins can copy this from group info)",
  );
  console.log(
    `  3. Detect by message — send "${phraseDisplay}" in the chat/group`,
  );
  console.log("  4. Enter a raw JID (advanced)");
  console.log();

  const choice = Number.parseInt(
    (await rl.question("Enter number [1-4]: ")).trim(),
    10,
  );

  if (choice === 1) {
    if (!myAccount) {
      throw new Error(
        "Linked account id is not available yet. Re-run setup after connecting, or use another option.",
      );
    }
    console.log(`Using ${formatListedTarget(myAccount)}`);
    return myAccount;
  }
  if (choice === 2) {
    return await resolveWhatsAppTargetFromInvite(rl, adapter);
  }
  if (choice === 3) {
    return await detectWhatsAppTargetByPhrase(rl, adapter, phraseDisplay);
  }
  if (choice === 4) {
    return await enterRawWhatsAppJid(rl, adapter);
  }

  throw new Error("Invalid selection.");
}

async function detectWhatsAppTargetByPhrase(
  rl: readline.Interface,
  adapter: WhatsAppAdapter,
  phraseDisplay: string,
): Promise<ListedTarget> {
  console.log(`
Detect WhatsApp target
----------------------
1. Open the WhatsApp chat or group you want HITL to use
2. Send exactly (or close to): ${phraseDisplay}
3. Wait here — we'll list matches and ask you to confirm

Listening for up to 90 seconds...
`);

  const matches = await adapter.waitForSetupPhrase({
    timeoutMs: 90_000,
    onMatch: (target, text) => {
      console.log(`Heard "${text}" in ${formatListedTarget(target)}`);
    },
  });

  if (matches.length === 0) {
    throw new Error(
      `No "${phraseDisplay}" message detected. Send it in the target chat and try again.`,
    );
  }

  let selected: ListedTarget;
  if (matches.length === 1) {
    const only = matches[0]!;
    const ok = (
      await rl.question(`Use ${formatListedTarget(only)}? [Y/n]: `)
    )
      .trim()
      .toLowerCase();
    if (ok === "n" || ok === "no") {
      throw new Error("Target selection cancelled.");
    }
    selected = only;
  } else {
    console.log("\nMultiple chats matched:\n");
    matches.forEach((target, i) => {
      console.log(`  ${i + 1}. ${formatListedTarget(target)}`);
    });
    console.log();
    const pick =
      Number.parseInt(
        (await rl.question(`Enter number [1-${matches.length}]: `)).trim(),
        10,
      ) - 1;
    if (Number.isNaN(pick) || pick < 0 || pick >= matches.length) {
      throw new Error("Invalid selection.");
    }
    selected = matches[pick]!;
  }

  // Refresh label / normalize JID before greeting + save.
  return await adapter.resolveTargetInfo(selected.targetId);
}

async function resolveWhatsAppTargetFromInvite(
  rl: readline.Interface,
  adapter: WhatsAppAdapter,
): Promise<ListedTarget> {
  console.log(`
Group invite link
-----------------
On WhatsApp (admin): Group info → Invite via link → Copy link
Paste the full https://chat.whatsapp.com/... link (or just the code).

You should already be a member of the group so HITL can send/receive there.
`);

  const link = (await rl.question("Invite link or code: ")).trim();
  const resolved = await adapter.resolveGroupInvite(link);
  console.log(`\nResolved: ${formatListedTarget(resolved)}`);
  const ok = (await rl.question("Use this group? [Y/n]: ")).trim().toLowerCase();
  if (ok === "n" || ok === "no") {
    throw new Error("Target selection cancelled.");
  }
  return resolved;
}

async function enterRawWhatsAppJid(
  rl: readline.Interface,
  adapter: WhatsAppAdapter,
): Promise<ListedTarget> {
  console.log(`
Raw WhatsApp JID
----------------
Groups end with @g.us; DMs usually end with @s.whatsapp.net or @lid.
`);

  const jid = (await rl.question("Chat / group JID: ")).trim();
  const resolved = await adapter.resolveTargetInfo(jid);
  console.log(`Resolved: ${formatListedTarget(resolved)}`);
  return resolved;
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
  if (target.label && target.label !== target.targetId) {
    return `${target.label} (${target.targetId})`;
  }
  return target.targetId;
}
