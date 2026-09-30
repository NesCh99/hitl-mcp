import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CredentialStore } from "../src/auth/credential-store.js";
import { ChannelManager } from "../src/channels/channel-manager.js";
import {
  WhatsAppAdapter,
} from "../src/channels/whatsapp/whatsapp-adapter.js";
import { formatHitlOutbound } from "../src/core/outbound-format.js";
import {
  parseWhatsAppCredentials,
  redactSecrets,
  safeErrorMessage,
} from "../src/channels/whatsapp/whatsapp-auth.js";
import {
  mapWhatsAppEventToIncoming,
  normalizeWhatsAppMessage,
} from "../src/channels/whatsapp/whatsapp-events.js";
import type {
  WhatsAppEventMap,
  WhatsAppSocket,
} from "../src/channels/whatsapp/types.js";
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

function createMockSocket(): {
  socket: WhatsAppSocket;
  emit: <E extends keyof WhatsAppEventMap>(
    event: E,
    payload: WhatsAppEventMap[E],
  ) => void;
  sendMessage: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  requestPairingCode: ReturnType<typeof vi.fn>;
  waitForSocketOpen: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  const sendMessage = vi.fn(
    async (
      jid: string,
      content: { text: string },
      _options?: { quoted?: unknown },
    ) => {
      const id = `out-${sendMessage.mock.calls.length}`;
      return {
        key: { remoteJid: jid, id, fromMe: true },
        message: { conversation: content.text },
      };
    },
  );
  const end = vi.fn();
  const requestPairingCode = vi.fn(async () => "1234-5678");
  const waitForSocketOpen = vi.fn(async () => undefined);

  const socket: WhatsAppSocket = {
    ev: {
      on(event, handler) {
        const list = handlers.get(event) ?? [];
        list.push(handler as (payload: unknown) => void);
        handlers.set(event, list);
      },
      off(event, handler) {
        const list = handlers.get(event) ?? [];
        handlers.set(
          event,
          list.filter((h) => h !== handler),
        );
      },
    },
    authState: { creds: { registered: true, me: { id: "me@s.whatsapp.net" } } },
    user: { id: "me@s.whatsapp.net" },
    sendMessage,
    requestPairingCode,
    waitForSocketOpen,
    end,
  };

  return {
    socket,
    sendMessage,
    end,
    requestPairingCode,
    waitForSocketOpen,
    emit: (event, payload) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(payload);
      }
    },
  };
}

describe("formatHitlOutbound", () => {
  it("prefixes assistant once", () => {
    expect(formatHitlOutbound("Hi")).toBe("*assistant* Hi");
    expect(formatHitlOutbound("*assistant* Hi")).toBe("*assistant* Hi");
  });
});

describe("WhatsApp credentials helpers", () => {
  it("parses valid credentials", () => {
    const creds = parseWhatsAppCredentials({
      authDir: "/tmp/whatsapp-auth",
      linkMethod: "qr",
    });
    expect(creds.authDir).toBe("/tmp/whatsapp-auth");
  });

  it("redacts auth paths and phone numbers from errors", () => {
    expect(
      redactSecrets("fail /Users/nestor/.hitl-mcp/credentials/whatsapp-auth"),
    ).toContain("[AUTH_DIR]");
    expect(safeErrorMessage(new Error("phone 15551234567 leaked"))).not.toContain(
      "15551234567",
    );
  });
});

describe("WhatsApp event mapping", () => {
  it("maps a quoted reply into the core correlation shape", () => {
    expect(
      mapWhatsAppEventToIncoming({
        chatId: "chat-1",
        messageId: "message-2",
        senderId: "human-1",
        text: "Yes",
        quotedMessageId: "message-1",
      }),
    ).toEqual({
      channel: "whatsapp",
      id: "chat-1",
      messageId: "message-2",
      replyToMessageId: "message-1",
      senderId: "human-1",
      text: "Yes",
    });
  });

  it("normalizes Baileys-like messages and ignores noise", () => {
    expect(
      normalizeWhatsAppMessage({
        key: {
          remoteJid: "1555@s.whatsapp.net",
          id: "msg-1",
          fromMe: false,
        },
        message: {
          extendedTextMessage: {
            text: "Use B",
            contextInfo: { stanzaId: "root-1" },
          },
        },
      }),
    ).toEqual({
      chatId: "1555@s.whatsapp.net",
      messageId: "msg-1",
      senderId: "1555@s.whatsapp.net",
      text: "Use B",
      quotedMessageId: "root-1",
      fromMe: false,
    });

    expect(
      normalizeWhatsAppMessage({
        key: {
          remoteJid: "status@broadcast",
          id: "x",
          fromMe: false,
        },
        message: { conversation: "story" },
      }),
    ).toBeUndefined();

    expect(
      normalizeWhatsAppMessage({
        key: {
          remoteJid: "1555@s.whatsapp.net",
          id: "x",
          fromMe: true,
        },
        message: { conversation: "mine" },
      }),
    ).toBeUndefined();
  });
});

describe("WhatsAppAdapter", () => {
  let store: MemoryCredentialStore;
  let mock: ReturnType<typeof createMockSocket>;
  let adapter: WhatsAppAdapter;

  beforeEach(async () => {
    store = new MemoryCredentialStore();
    await store.set("whatsapp", {
      authDir: "/tmp/hitl-whatsapp-auth-test",
      linkMethod: "qr",
    });
    mock = createMockSocket();
    adapter = new WhatsAppAdapter({
      credentialStore: store,
      printQr: false,
      createSocket: async () => {
        // Emit after connect() registers its wait listener.
        setTimeout(() => {
          mock.emit("connection.update", { connection: "open" });
        }, 0);
        return {
          socket: mock.socket,
          saveCreds: async () => undefined,
        };
      },
    });
  });

  async function connectAdapter(): Promise<void> {
    await adapter.connect();
  }

  it("authenticates from the credential store and caches self JID on connect", async () => {
    expect(await adapter.isAuthenticated()).toBe(true);
    await adapter.authenticate();
    await connectAdapter();

    const stored = (await store.get("whatsapp")) as { selfJid?: string };
    expect(stored.selfJid).toBe("me@s.whatsapp.net");
  });

  it("reconnects after Baileys restart-required (515) following QR link", async () => {
    let attempts = 0;
    const first = createMockSocket();
    const second = createMockSocket();

    adapter = new WhatsAppAdapter({
      credentialStore: store,
      printQr: false,
      createSocket: async () => {
        attempts += 1;
        if (attempts === 1) {
          setTimeout(() => {
            first.emit("connection.update", {
              connection: "close",
              lastDisconnect: {
                error: { output: { statusCode: 515 } },
              },
            });
          }, 0);
          return {
            socket: first.socket,
            saveCreds: async () => undefined,
          };
        }

        setTimeout(() => {
          second.emit("connection.update", { connection: "open" });
        }, 0);
        return {
          socket: second.socket,
          saveCreds: async () => undefined,
        };
      },
    });

    await adapter.connect();
    expect(attempts).toBe(2);
    expect(first.end).toHaveBeenCalledOnce();
  });

  it("requests a pairing code after the socket starts connecting", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await store.set("whatsapp", {
      authDir: "/tmp/hitl-whatsapp-auth-test",
      linkMethod: "pairing",
      phoneNumber: "15551234567",
    });

    mock = createMockSocket();
    mock.socket.authState = { creds: { registered: false } };
    mock.requestPairingCode.mockResolvedValue("ABCD1234");

    adapter = new WhatsAppAdapter({
      credentialStore: store,
      printQr: false,
      pairingReadyDelayMs: 0,
      createSocket: async () => {
        setTimeout(() => {
          mock.emit("connection.update", { qr: "fake-qr" });
          setTimeout(() => {
            mock.emit("connection.update", { connection: "open" });
          }, 5);
        }, 0);
        return {
          socket: mock.socket,
          saveCreds: async () => undefined,
        };
      },
    });

    await adapter.connect();
    expect(mock.waitForSocketOpen).toHaveBeenCalled();
    expect(mock.requestPairingCode).toHaveBeenCalledWith("15551234567");
    expect(log.mock.calls.flat().join("\n")).toContain("ABCD-1234");
    log.mockRestore();
  });

  it("lists discovered chats as targets", async () => {
    mock = createMockSocket();
    adapter = new WhatsAppAdapter({
      credentialStore: store,
      printQr: false,
      createSocket: async () => {
        setTimeout(() => {
          mock.emit("contacts.upsert", [
            {
              id: "111@s.whatsapp.net",
              name: "Alice",
            },
          ]);
          mock.emit("chats.upsert", [
            { id: "111@s.whatsapp.net" },
            { id: "status@broadcast", name: "Status" },
            { id: "999@g.us", name: "Team" },
            { id: "124700@lid" },
          ]);
          mock.emit("contacts.upsert", [
            {
              id: "124700@lid",
              lid: "124700@lid",
              notify: "Bob",
            },
          ]);
          mock.emit("connection.update", { connection: "open" });
        }, 0);
        return {
          socket: mock.socket,
          saveCreds: async () => undefined,
        };
      },
    });

    await connectAdapter();

    const targets = await adapter.listTargets();
    expect(targets.map((t) => t.id).sort()).toEqual([
      "111@s.whatsapp.net",
      "124700@lid",
      "999@g.us",
      "me@s.whatsapp.net",
    ]);
    expect(targets.find((t) => t.id === "111@s.whatsapp.net")?.label).toBe(
      "Alice",
    );
    expect(targets.find((t) => t.id === "999@g.us")?.label).toBe("Team");
    expect(targets.find((t) => t.id === "124700@lid")?.label).toBe("Bob");
    expect(targets.find((t) => t.id === "me@s.whatsapp.net")?.label).toBe(
      "Me (this account)",
    );

    expect(adapter.getMyAccountTarget()).toEqual({
      channel: "whatsapp",
      id: "me@s.whatsapp.net",
      label: "Me (this account)",
    });
  });

  it("sends a setup greeting as a plain message", async () => {
    await connectAdapter();
    await adapter.sendPlainMessage(
      "111@s.whatsapp.net",
      "Hi — your channel is connected and ready.",
    );
    expect(mock.sendMessage).toHaveBeenCalledWith(
      "111@s.whatsapp.net",
      {
        text: "*assistant* Hi — your channel is connected and ready.",
      },
      undefined,
    );
  });

  it("opens a session root then quotes it for later asks", async () => {
    await connectAdapter();

    const sent = await adapter.sendMessage("111@s.whatsapp.net", "Should I proceed?", {
      session: { id: "chat-1", name: "Feature X" },
    });

    expect(mock.sendMessage.mock.calls[0]?.[1]).toEqual({
      text: "*assistant* Started working on Feature X",
    });
    expect(mock.sendMessage.mock.calls[1]?.[1]).toEqual({
      text: "*assistant* Should I proceed?",
    });
    expect(mock.sendMessage.mock.calls[1]?.[2]).toEqual({
      quoted: expect.objectContaining({
        key: expect.objectContaining({ id: "out-1" }),
      }),
    });
    expect(sent).toEqual({
      messageId: "out-2",
      correlationId: "out-1",
      target: { channel: "whatsapp", id: "111@s.whatsapp.net" },
      text: "Should I proceed?",
    });
    expect(adapter.getSessionThread("111@s.whatsapp.net", "chat-1")?.rootMessageId).toBe(
      "out-1",
    );
  });

  it("requires a session for WhatsApp sends", async () => {
    await connectAdapter();

    await expect(
      adapter.sendMessage("111@s.whatsapp.net", "Nope"),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof HitlError && err.code === "INVALID_TARGET",
    );
  });

  it("accepts fromMe replies that quote a HITL ask (same linked account)", async () => {
    await connectAdapter();

    const channels = new ChannelManager();
    channels.register(adapter);
    const config: HitlConfig = {
      defaultTarget: "whatsapp",
      targets: [{ channel: "whatsapp", id: "999@g.us" }],
      channels: { whatsapp: { enabled: true } },
    };
    const hitl = new HitlManager(channels, () => config);
    hitl.startListening();

    const ask = hitl.askHuman({
      question: "Ship it?",
      connectionId: "conn-1",
      session: { id: "chat-1", name: "Ship" },
      timeoutMs: 2000,
    });

    await new Promise((r) => setTimeout(r, 10));
    const askMessageId = "out-2";

    // Echo of our own outbound ask must not resolve the pending request.
    mock.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "999@g.us",
            id: askMessageId,
            fromMe: true,
          },
          message: { conversation: "*assistant* Ship it?" },
        },
      ],
    });
    expect(hitl.getPendingManager().size()).toBe(1);

    mock.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "999@g.us",
            id: "in-from-me",
            fromMe: true,
            participant: "me@s.whatsapp.net",
          },
          message: {
            extendedTextMessage: {
              text: "yes",
              contextInfo: { stanzaId: askMessageId },
            },
          },
        },
      ],
    });

    const result = await ask;
    expect(result).toMatchObject({ kind: "answered", response: { text: "yes" } });
    expect(hitl.getPendingManager().size()).toBe(0);
  });

  it("does not resolve a plain fromMe message without a quote", async () => {
    await connectAdapter();

    const channels = new ChannelManager();
    channels.register(adapter);
    const config: HitlConfig = {
      defaultTarget: "whatsapp",
      targets: [{ channel: "whatsapp", id: "999@g.us" }],
      channels: { whatsapp: { enabled: true } },
    };
    const hitl = new HitlManager(channels, () => config);
    hitl.startListening();

    const ask = hitl.askHuman({
      question: "Go?",
      connectionId: "conn-1",
      session: { id: "chat-1", name: "Go" },
      timeoutMs: 80,
    });

    await new Promise((r) => setTimeout(r, 10));

    mock.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "999@g.us",
            id: "in-plain",
            fromMe: true,
          },
          message: { conversation: "go ahead" },
        },
      ],
    });

    await expect(ask).rejects.toSatisfy(
      (err: unknown) => err instanceof HitlError && err.code === "TIMEOUT",
    );
  });

  it("remaps quotes of session messages to the root for pending asks", async () => {
    await connectAdapter();

    const channels = new ChannelManager();
    channels.register(adapter);
    const config: HitlConfig = {
      defaultTarget: "whatsapp",
      targets: [{ channel: "whatsapp", id: "111@s.whatsapp.net" }],
      channels: { whatsapp: { enabled: true } },
    };
    const hitl = new HitlManager(channels, () => config);
    hitl.startListening();

    const ask = hitl.askHuman({
      question: "Ship it?",
      connectionId: "conn-1",
      session: { id: "chat-1", name: "Ship" },
      timeoutMs: 2000,
    });

    await new Promise((r) => setTimeout(r, 10));
    const rootId = adapter.getSessionThread("111@s.whatsapp.net", "chat-1")!.rootMessageId;
    const askMessageId = "out-2";

    mock.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "111@s.whatsapp.net",
            id: "in-1",
            fromMe: false,
          },
          message: {
            extendedTextMessage: {
              text: "Yes, ship it",
              contextInfo: { stanzaId: askMessageId },
            },
          },
        },
      ],
    });

    const result = await ask;
    expect(result).toMatchObject({
      kind: "answered",
      response: { text: "Yes, ship it", replyToMessageId: rootId },
    });
    expect(hitl.getPendingManager().size()).toBe(0);
  });

  it("isolates two concurrent sessions into separate roots", async () => {
    await connectAdapter();

    const channels = new ChannelManager();
    channels.register(adapter);
    const config: HitlConfig = {
      defaultTarget: "whatsapp",
      targets: [{ channel: "whatsapp", id: "111@s.whatsapp.net" }],
      channels: { whatsapp: { enabled: true } },
    };
    const hitl = new HitlManager(channels, () => config);
    hitl.startListening();

    const askA = hitl.askHuman({
      question: "A?",
      connectionId: "conn-a",
      session: { id: "chat-a", name: "Chat A" },
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 10));
    const rootA = adapter.getSessionThread("111@s.whatsapp.net", "chat-a")!.rootMessageId;

    const askB = hitl.askHuman({
      question: "B?",
      connectionId: "conn-b",
      session: { id: "chat-b", name: "Chat B" },
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 10));
    const rootB = adapter.getSessionThread("111@s.whatsapp.net", "chat-b")!.rootMessageId;

    expect(rootA).not.toBe(rootB);

    mock.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "111@s.whatsapp.net",
            id: "in-b",
            fromMe: false,
          },
          message: {
            extendedTextMessage: {
              text: "Answer B",
              contextInfo: { stanzaId: rootB },
            },
          },
        },
        {
          key: {
            remoteJid: "111@s.whatsapp.net",
            id: "in-a",
            fromMe: false,
          },
          message: {
            extendedTextMessage: {
              text: "Answer A",
              contextInfo: { stanzaId: rootA },
            },
          },
        },
      ],
    });

    const [a, b] = await Promise.all([askA, askB]);
    expect(a).toMatchObject({ kind: "answered", response: { text: "Answer A" } });
    expect(b).toMatchObject({ kind: "answered", response: { text: "Answer B" } });
  });

  it("clears session threads on disconnect", async () => {
    await connectAdapter();

    await adapter.sendMessage("111@s.whatsapp.net", "hi", {
      session: { id: "chat-1", name: "Chat" },
    });
    expect(adapter.getSessionThread("111@s.whatsapp.net", "chat-1")).toBeDefined();
    await adapter.disconnect();
    expect(adapter.getSessionThread("111@s.whatsapp.net", "chat-1")).toBeUndefined();
    expect(mock.end).toHaveBeenCalledOnce();
  });
});
