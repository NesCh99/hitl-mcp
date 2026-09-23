import { LogLevel, WebClient } from "@slack/web-api";
import { LogLevel as SocketLogLevel, SocketModeClient } from "@slack/socket-mode";
import type { CredentialStore } from "../../auth/credential-store.js";
import { HitlError } from "../../core/types.js";
import type {
  ChannelType,
  SendMessageOptions,
  SentMessage,
  SessionRef,
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

interface SlackSessionThread {
  targetId: string;
  sessionId: string;
  /** Root message ts — all replies in this thread use thread_ts = rootTs. */
  rootTs: string;
  label: string;
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

function sessionKey(targetId: string, sessionId: string): string {
  return `${targetId}::${sessionId}`;
}

function sessionLabel(session: SessionRef): string {
  const name = session.name?.trim();
  if (name) {
    return name;
  }
  return session.id;
}

/**
 * Slack ChannelAdapter using Socket Mode.
 *
 * One MCP connection (`session`) → one Slack thread in the target channel:
 * 1. First message opens a root: "Started working on {name|id}"
 * 2. ask_human / notify_human posts go into that thread
 * 3. Human replies in the thread; thread_ts correlates to the session root
 *
 * Concurrent sessions → concurrent threads in the same channel.
 */
export class SlackAdapter implements ChannelAdapter {
  readonly type: ChannelType = "slack";

  private readonly credentialStore: CredentialStore;
  private readonly createWebClient: CreateWebClient;
  private readonly createSocketClient: CreateSocketClient;

  private readonly handlers: MessageHandler[] = [];
  /** In-memory only — session threads disappear when the process exits. */
  private readonly sessions = new Map<string, SlackSessionThread>();
  private readonly sessionLocks = new Map<string, Promise<SlackSessionThread>>();

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
    this.sessions.clear();
    this.sessionLocks.clear();

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

  async sendMessage(
    targetId: string,
    message: string,
    options?: SendMessageOptions,
  ): Promise<SentMessage> {
    await this.connect();

    const session = options?.session;
    if (!session?.id) {
      throw new HitlError(
        "INVALID_TARGET",
        "Slack requires a session id so messages can share a thread.",
      );
    }

    const thread = await this.ensureSessionThread(targetId, session);
    const result = await this.post(targetId, message, thread.rootTs);

    return {
      messageId: result.ts!,
      // Replies in this Slack thread have thread_ts = rootTs.
      correlationId: thread.rootTs,
      target: { channel: "slack", targetId: result.channel ?? targetId },
      text: message,
    };
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  /** Test helper: inspect in-memory session threads. */
  getSessionThread(targetId: string, sessionId: string): SlackSessionThread | undefined {
    return this.sessions.get(sessionKey(targetId, sessionId));
  }

  private async ensureSessionThread(
    targetId: string,
    session: SessionRef,
  ): Promise<SlackSessionThread> {
    const key = sessionKey(targetId, session.id);
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const inFlight = this.sessionLocks.get(key);
    if (inFlight) {
      return inFlight;
    }

    const create = this.openSessionThread(targetId, session, key);
    this.sessionLocks.set(key, create);
    try {
      return await create;
    } finally {
      this.sessionLocks.delete(key);
    }
  }

  private async openSessionThread(
    targetId: string,
    session: SessionRef,
    key: string,
  ): Promise<SlackSessionThread> {
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const label = sessionLabel(session);
    const opener = `Started working on ${label}`;
    const result = await this.post(targetId, opener);

    const thread: SlackSessionThread = {
      targetId,
      sessionId: session.id,
      rootTs: result.ts!,
      label,
    };
    this.sessions.set(key, thread);
    return thread;
  }

  private async post(
    targetId: string,
    text: string,
    threadTs?: string,
  ): Promise<{ ok?: boolean; ts?: string; channel?: string; error?: string }> {
    const web = await this.requireWeb();

    let result;
    try {
      result = await web.chat.postMessage({
        channel: targetId,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
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

    return result;
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

      const incoming = mapSlackEventToIncoming(
        event as Parameters<typeof mapSlackEventToIncoming>[0],
        { botUserId: this.credentials?.botUserId },
      );

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
