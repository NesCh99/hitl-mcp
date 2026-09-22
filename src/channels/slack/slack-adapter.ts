import { LogLevel, WebClient } from "@slack/web-api";
import { LogLevel as SocketLogLevel, SocketModeClient } from "@slack/socket-mode";
import type { CredentialStore } from "../../auth/credential-store.js";
import { HitlError } from "../../core/types.js";
import type {
  ChannelType,
  SentMessage,
} from "../../core/types.js";
import type {
  ChannelAdapter,
  ListedTarget,
  MessageHandler,
} from "../channel-adapter.js";
import {
  parseSlackCredentials,
  safeErrorMessage,
  type SlackCredentials,
} from "./slack-auth.js";
import { mapSlackEventToIncoming } from "./slack-events.js";
import type {
  CreateSocketClient,
  CreateWebClient,
  SlackSocketClient,
  SlackWebApi,
} from "./types.js";

export interface SlackAdapterOptions {
  credentialStore: CredentialStore;
  /** Override for tests. */
  createWebClient?: CreateWebClient;
  /** Override for tests. */
  createSocketClient?: CreateSocketClient;
}

function defaultCreateWebClient(botToken: string): SlackWebApi {
  return new WebClient(botToken, { logLevel: LogLevel.ERROR }) as unknown as SlackWebApi;
}

function defaultCreateSocketClient(appToken: string): SlackSocketClient {
  return new SocketModeClient({
    appToken,
    logLevel: SocketLogLevel.ERROR,
    autoReconnectEnabled: true,
  }) as unknown as SlackSocketClient;
}

/**
 * Slack ChannelAdapter using Socket Mode.
 *
 * All Slack-specific behavior stays here: tokens, Socket Mode, channel IDs,
 * `ts` / `thread_ts` correlation, and event mapping into IncomingMessage.
 *
 * Humans should reply **in the thread** of the ask_human question so
 * `thread_ts` can resolve the pending request.
 */
export class SlackAdapter implements ChannelAdapter {
  readonly type: ChannelType = "slack";

  private readonly credentialStore: CredentialStore;
  private readonly createWebClient: CreateWebClient;
  private readonly createSocketClient: CreateSocketClient;

  private readonly handlers: MessageHandler[] = [];
  private credentials: SlackCredentials | undefined;
  private web: SlackWebApi | undefined;
  private socket: SlackSocketClient | undefined;
  private connected = false;
  private connecting: Promise<void> | undefined;

  constructor(options: SlackAdapterOptions) {
    this.credentialStore = options.credentialStore;
    this.createWebClient = options.createWebClient ?? defaultCreateWebClient;
    this.createSocketClient =
      options.createSocketClient ?? defaultCreateSocketClient;
  }

  async isAuthenticated(): Promise<boolean> {
    if (this.credentials) {
      return true;
    }
    const stored = await this.credentialStore.get("slack");
    if (!stored) {
      return false;
    }
    try {
      parseSlackCredentials(stored);
      return true;
    } catch {
      return false;
    }
  }

  async authenticate(): Promise<void> {
    const stored = await this.credentialStore.get("slack");
    if (!stored) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        "Slack credentials not found. Run `hitl-mcp setup` and choose Slack.",
      );
    }

    let credentials: SlackCredentials;
    try {
      credentials = parseSlackCredentials(stored);
    } catch (error) {
      throw new HitlError(
        "CONFIG_ERROR",
        `Invalid Slack credentials: ${safeErrorMessage(error)}`,
      );
    }

    const web = this.createWebClient(credentials.botToken);
    let auth;
    try {
      auth = await web.auth.test();
    } catch (error) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        `Slack auth.test failed: ${safeErrorMessage(error)}`,
      );
    }

    if (!auth.ok || !auth.user_id) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        `Slack auth.test failed: ${auth.error ?? "unknown error"}`,
      );
    }

    const next: SlackCredentials = {
      ...credentials,
      botUserId: auth.user_id,
      teamId: auth.team_id,
      teamName: auth.team,
    };

    await this.credentialStore.set("slack", next);
    this.credentials = next;
    this.web = web;
  }

  async connect(): Promise<void> {
    if (this.connected && this.socket) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.doConnect();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.connected = false;

    if (socket) {
      try {
        await socket.disconnect();
      } catch (error) {
        throw new HitlError(
          "CONNECTION_FAILURE",
          `Failed to disconnect Slack Socket Mode: ${safeErrorMessage(error)}`,
        );
      }
    }
  }

  async listTargets(): Promise<ListedTarget[]> {
    const web = await this.requireWeb();
    const targets: ListedTarget[] = [];
    let cursor: string | undefined;

    do {
      let result;
      try {
        result = await web.conversations.list({
          types: "public_channel,private_channel",
          exclude_archived: true,
          limit: 200,
          cursor,
        });
      } catch (error) {
        throw new HitlError(
          "CONNECTION_FAILURE",
          `Slack conversations.list failed: ${safeErrorMessage(error)}`,
        );
      }

      if (!result.ok) {
        throw new HitlError(
          "CONNECTION_FAILURE",
          `Slack conversations.list failed: ${result.error ?? "unknown error"}`,
        );
      }

      for (const channel of result.channels ?? []) {
        if (!channel.id || channel.is_archived) {
          continue;
        }
        // Only destinations the bot can actually use.
        if (!channel.is_member) {
          continue;
        }

        const name = channel.name ? `#${channel.name}` : channel.id;
        const kind = channel.is_private ? "private" : "public";
        targets.push({
          channel: "slack",
          targetId: channel.id,
          label: `${name} (${kind})`,
        });
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    targets.sort((a, b) => (a.label ?? a.targetId).localeCompare(b.label ?? b.targetId));
    return targets;
  }

  async sendMessage(targetId: string, message: string): Promise<SentMessage> {
    await this.connect();
    const web = await this.requireWeb();

    let result;
    try {
      result = await web.chat.postMessage({
        channel: targetId,
        text: message,
      });
    } catch (error) {
      throw new HitlError(
        "CONNECTION_FAILURE",
        `Slack chat.postMessage failed: ${safeErrorMessage(error)}`,
      );
    }

    if (!result.ok || !result.ts) {
      const err = result.error ?? "unknown error";
      if (err === "channel_not_found" || err === "not_in_channel") {
        throw new HitlError(
          "TARGET_NOT_FOUND",
          `Slack target "${targetId}" was not found or the bot is not a member.`,
        );
      }
      throw new HitlError(
        "CONNECTION_FAILURE",
        `Slack chat.postMessage failed: ${err}`,
      );
    }

    return {
      messageId: result.ts,
      target: { channel: "slack", targetId: result.channel ?? targetId },
      text: message,
    };
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  private async doConnect(): Promise<void> {
    if (!this.credentials || !this.web) {
      await this.authenticate();
    }

    const credentials = this.credentials;
    if (!credentials) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        "Slack is not authenticated.",
      );
    }

    const socket = this.createSocketClient(credentials.appToken);
    this.attachMessageListener(socket);
    this.socket = socket;

    try {
      await socket.start();
    } catch (error) {
      this.socket = undefined;
      this.connected = false;
      throw new HitlError(
        "CONNECTION_FAILURE",
        `Slack Socket Mode failed to start: ${safeErrorMessage(error)}`,
      );
    }

    this.connected = true;
  }

  private attachMessageListener(socket: SlackSocketClient): void {
    socket.on("message", async ({ ack, event }) => {
      try {
        await ack();
      } catch {
        // Acknowledgement failures should not crash the process.
      }

      const incoming = mapSlackEventToIncoming(event as Parameters<typeof mapSlackEventToIncoming>[0], {
        botUserId: this.credentials?.botUserId,
      });

      if (!incoming) {
        return;
      }

      for (const handler of this.handlers) {
        try {
          handler(incoming);
        } catch {
          // Handler errors must not break the Socket Mode loop.
        }
      }
    });
  }

  private async requireWeb(): Promise<SlackWebApi> {
    if (!this.web || !this.credentials) {
      await this.authenticate();
    }
    if (!this.web) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        "Slack Web API client is not available.",
      );
    }
    return this.web;
  }
}
