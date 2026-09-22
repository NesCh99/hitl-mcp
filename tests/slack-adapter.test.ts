import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CredentialStore } from "../src/auth/credential-store.js";
import { ChannelManager } from "../src/channels/channel-manager.js";
import { SlackAdapter } from "../src/channels/slack/slack-adapter.js";
import {
  parseSlackCredentials,
  redactSecrets,
  safeErrorMessage,
} from "../src/channels/slack/slack-auth.js";
import { mapSlackEventToIncoming } from "../src/channels/slack/slack-events.js";
import type {
  SlackSocketClient,
  SlackSocketMessageHandler,
  SlackWebApi,
} from "../src/channels/slack/types.js";
import { HitlManager } from "../src/core/hitl-manager.js";
import { HitlError } from "../src/core/types.js";
import type { HitlConfig } from "../src/config/config-schema.js";

class MemoryCredentialStore implements CredentialStore {
  private readonly data = new Map<string, unknown>();

  async get(provider: string): Promise<unknown | undefined> {
    return this.data.get(provider);
  }

  async set(provider: string, credentials: unknown): Promise<void> {
    this.data.set(provider, credentials);
  }

  async delete(provider: string): Promise<void> {
    this.data.delete(provider);
  }
}

function createMockWeb(overrides?: Partial<{
  authTest: SlackWebApi["auth"]["test"];
  conversationsList: SlackWebApi["conversations"]["list"];
  postMessage: SlackWebApi["chat"]["postMessage"];
}>): SlackWebApi {
  return {
    auth: {
      test:
        overrides?.authTest ??
        (async () => ({
          ok: true,
          user_id: "U_BOT",
          team_id: "T1",
          team: "Acme",
        })),
    },
    conversations: {
      list:
        overrides?.conversationsList ??
        (async () => ({
          ok: true,
          channels: [
            {
              id: "C_PUBLIC",
              name: "local-hitl",
              is_private: false,
              is_member: true,
            },
            {
              id: "C_PRIVATE",
              name: "agents",
              is_private: true,
              is_member: true,
            },
            {
              id: "C_OTHER",
              name: "random",
              is_private: false,
              is_member: false,
            },
          ],
        })),
    },
    chat: {
      postMessage:
        overrides?.postMessage ??
        (async ({ channel, text }) => ({
          ok: true,
          ts: "111.222",
          channel,
          message: { text },
        })),
    },
  };
}

function createMockSocket(): {
  socket: SlackSocketClient;
  emitMessage: (event: Record<string, unknown>) => Promise<void>;
  start: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
} {
  let handler: SlackSocketMessageHandler | undefined;
  const start = vi.fn(async () => undefined);
  const disconnect = vi.fn(async () => undefined);

  const socket: SlackSocketClient = {
    on(event, h) {
      if (event === "message") {
        handler = h;
      }
    },
    start,
    disconnect,
  };

  return {
    socket,
    start,
    disconnect,
    emitMessage: async (event) => {
      if (!handler) {
        throw new Error("No message handler attached");
      }
      await handler({
        ack: vi.fn(async () => undefined),
        event,
      });
    },
  };
}

describe("Slack credentials helpers", () => {
  it("parses valid credentials", () => {
    const creds = parseSlackCredentials({
      botToken: "xoxb-test-bot",
      appToken: "xapp-test-app",
    });
    expect(creds.botToken).toBe("xoxb-test-bot");
  });

  it("redacts tokens from errors", () => {
    expect(redactSecrets("fail xoxb-abc-123 and xapp-xyz-9")).toContain(
      "[REDACTED]",
    );
    expect(safeErrorMessage(new Error("bad xoxb-secret-token"))).not.toContain(
      "xoxb-secret-token",
    );
  });
});

describe("mapSlackEventToIncoming", () => {
  it("maps a thread reply with messageId and replyToMessageId", () => {
    const incoming = mapSlackEventToIncoming({
      type: "message",
      channel: "C123",
      user: "U456",
      text: "Yes",
      ts: "200.2",
      thread_ts: "100.1",
    });

    expect(incoming).toEqual({
      channel: "slack",
      targetId: "C123",
      messageId: "200.2",
      replyToMessageId: "100.1",
      senderId: "U456",
      text: "Yes",
    });
  });

  it("does not set replyToMessageId for root messages", () => {
    const incoming = mapSlackEventToIncoming({
      type: "message",
      channel: "C123",
      user: "U456",
      text: "hello",
      ts: "100.1",
    });
    expect(incoming?.replyToMessageId).toBeUndefined();
  });

  it("ignores bot messages, subtypes, and the bot user", () => {
    expect(
      mapSlackEventToIncoming({
        type: "message",
        subtype: "bot_message",
        channel: "C1",
        user: "U1",
        text: "x",
        ts: "1.1",
      }),
    ).toBeUndefined();

    expect(
      mapSlackEventToIncoming({
        type: "message",
        channel: "C1",
        user: "U1",
        bot_id: "B1",
        text: "x",
        ts: "1.1",
      }),
    ).toBeUndefined();

    expect(
      mapSlackEventToIncoming(
        {
          type: "message",
          channel: "C1",
          user: "U_BOT",
          text: "x",
          ts: "1.1",
          thread_ts: "0.1",
        },
        { botUserId: "U_BOT" },
      ),
    ).toBeUndefined();
  });
});

describe("SlackAdapter", () => {
  let store: MemoryCredentialStore;
  let mockSocket: ReturnType<typeof createMockSocket>;
  let adapter: SlackAdapter;

  beforeEach(async () => {
    store = new MemoryCredentialStore();
    await store.set("slack", {
      botToken: "xoxb-test-bot",
      appToken: "xapp-test-app",
    });
    mockSocket = createMockSocket();
    adapter = new SlackAdapter({
      credentialStore: store,
      createWebClient: () => createMockWeb(),
      createSocketClient: () => mockSocket.socket,
    });
  });

  it("authenticates via auth.test and caches bot user id", async () => {
    expect(await adapter.isAuthenticated()).toBe(true);
    await adapter.authenticate();
    const stored = (await store.get("slack")) as { botUserId?: string };
    expect(stored.botUserId).toBe("U_BOT");
  });

  it("connects Socket Mode and disconnects cleanly", async () => {
    await adapter.authenticate();
    await adapter.connect();
    expect(mockSocket.start).toHaveBeenCalledOnce();
    await adapter.disconnect();
    expect(mockSocket.disconnect).toHaveBeenCalledOnce();
  });

  it("lists only member public and private channels as targets", async () => {
    await adapter.authenticate();
    const targets = await adapter.listTargets();
    expect(targets.map((t) => t.targetId)).toEqual(["C_PRIVATE", "C_PUBLIC"]);
    expect(targets.find((t) => t.targetId === "C_PUBLIC")?.label).toBe(
      "#local-hitl (public)",
    );
    expect(targets.find((t) => t.targetId === "C_PRIVATE")?.label).toBe(
      "#agents (private)",
    );
  });

  it("sends messages and returns Slack ts as messageId", async () => {
    await adapter.authenticate();
    const sent = await adapter.sendMessage("C_PUBLIC", "Should I proceed?");
    expect(sent).toEqual({
      messageId: "111.222",
      target: { channel: "slack", targetId: "C_PUBLIC" },
      text: "Should I proceed?",
    });
  });

  it("converts socket message events into IncomingMessage for handlers", async () => {
    const received: string[] = [];
    adapter.onMessage((m) => received.push(m.text));

    await adapter.authenticate();
    await adapter.connect();

    await mockSocket.emitMessage({
      type: "message",
      channel: "C_PUBLIC",
      user: "U_HUMAN",
      text: "Use option B",
      ts: "300.3",
      thread_ts: "111.222",
    });

    expect(received).toEqual(["Use option B"]);
  });

  it("correlates a Slack thread reply with a pending ask_human request", async () => {
    const channels = new ChannelManager();
    channels.register(adapter);

    const config: HitlConfig = {
      defaultTarget: { channel: "slack", targetId: "C_PUBLIC" },
      channels: { slack: { enabled: true } },
    };
    const hitl = new HitlManager(channels, () => config);
    hitl.startListening();

    await adapter.authenticate();

    const ask = hitl.askHuman({
      question: "Ship it?",
      connectionId: "conn-1",
      timeoutMs: 2000,
    });

    // Allow send + pending registration
    await new Promise((r) => setTimeout(r, 10));

    await mockSocket.emitMessage({
      type: "message",
      channel: "C_PUBLIC",
      user: "U_HUMAN",
      text: "Yes, ship it",
      ts: "999.1",
      thread_ts: "111.222",
    });

    const result = await ask;
    expect(result.response.text).toBe("Yes, ship it");
    expect(result.response.replyToMessageId).toBe("111.222");
    expect(hitl.getPendingManager().size()).toBe(0);
  });

  it("handles two simultaneous pending requests without cross-talk", async () => {
    let messageCounter = 0;
    const web = createMockWeb({
      postMessage: async ({ channel, text }) => {
        messageCounter += 1;
        return {
          ok: true,
          ts: `out-${messageCounter}`,
          channel,
          message: { text },
        };
      },
    });

    const socketA = createMockSocket();
    const localAdapter = new SlackAdapter({
      credentialStore: store,
      createWebClient: () => web,
      createSocketClient: () => socketA.socket,
    });

    const channels = new ChannelManager();
    channels.register(localAdapter);
    const config: HitlConfig = {
      defaultTarget: { channel: "slack", targetId: "C_PUBLIC" },
      channels: { slack: { enabled: true } },
    };
    const hitl = new HitlManager(channels, () => config);
    hitl.startListening();
    await localAdapter.authenticate();

    const askA = hitl.askHuman({
      question: "A?",
      connectionId: "conn-a",
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 10));
    const askB = hitl.askHuman({
      question: "B?",
      connectionId: "conn-b",
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 10));

    await socketA.emitMessage({
      type: "message",
      channel: "C_PUBLIC",
      user: "U_HUMAN",
      text: "Answer B",
      ts: "in-b",
      thread_ts: "out-2",
    });
    await socketA.emitMessage({
      type: "message",
      channel: "C_PUBLIC",
      user: "U_HUMAN",
      text: "Answer A",
      ts: "in-a",
      thread_ts: "out-1",
    });

    const [a, b] = await Promise.all([askA, askB]);
    expect(a.response.text).toBe("Answer A");
    expect(b.response.text).toBe("Answer B");
  });

  it("does not resolve pending requests for unrelated Slack messages", async () => {
    const channels = new ChannelManager();
    channels.register(adapter);
    const config: HitlConfig = {
      defaultTarget: { channel: "slack", targetId: "C_PUBLIC" },
      channels: { slack: { enabled: true } },
    };
    const hitl = new HitlManager(channels, () => config);
    hitl.startListening();
    await adapter.authenticate();

    const ask = hitl.askHuman({
      question: "Waiting?",
      connectionId: "conn-1",
      timeoutMs: 80,
    });
    await new Promise((r) => setTimeout(r, 10));

    await mockSocket.emitMessage({
      type: "message",
      channel: "C_PUBLIC",
      user: "U_HUMAN",
      text: "random chatter",
      ts: "888.8",
      // no thread_ts → unrelated root message
    });

    await expect(ask).rejects.toSatisfy(
      (err: unknown) => err instanceof HitlError && err.code === "TIMEOUT",
    );
  });
});
