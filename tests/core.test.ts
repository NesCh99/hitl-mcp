import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelManager } from "../src/channels/channel-manager.js";
import { FakeChannelAdapter } from "../src/channels/fake/fake-channel-adapter.js";
import { ConfigManager } from "../src/config/config-manager.js";
import { HitlManager } from "../src/core/hitl-manager.js";
import { PendingRequestManager } from "../src/core/pending-request-manager.js";
import { HitlError } from "../src/core/types.js";
import type { HitlConfig } from "../src/config/config-schema.js";

describe("PendingRequestManager", () => {
  let manager: PendingRequestManager;

  beforeEach(() => {
    manager = new PendingRequestManager();
  });

  afterEach(() => {
    manager.clear();
  });

  it("creates a pending request", () => {
    const { requestId } = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", id: "local-hitl" },
      outboundMessageId: "msg-1",
    });

    expect(requestId).toBeTruthy();
    expect(manager.size()).toBe(1);
    expect(manager.get(requestId)?.outboundMessageId).toBe("msg-1");
  });

  it("resolves a pending request", async () => {
    const { requestId, promise } = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", id: "local-hitl" },
      outboundMessageId: "msg-1",
    });

    const ok = manager.resolve(requestId, {
      channel: "fake",
      id: "local-hitl",
      messageId: "reply-1",
      replyToMessageId: "msg-1",
      senderId: "human",
      text: "Use option B",
    });

    expect(ok).toBe(true);
    expect(manager.size()).toBe(0);
    await expect(promise).resolves.toMatchObject({ text: "Use option B" });
  });

  it("rejects a pending request", async () => {
    const { requestId, promise } = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", id: "local-hitl" },
      outboundMessageId: "msg-1",
    });

    manager.reject(requestId, new Error("boom"));
    expect(manager.size()).toBe(0);
    await expect(promise).rejects.toThrow("boom");
  });

  it("times out and cleans up when timeoutMs is set", async () => {
    const { promise } = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", id: "local-hitl" },
      outboundMessageId: "msg-1",
      timeoutMs: 30,
    });

    await expect(promise).rejects.toSatisfy((err: unknown) => {
      return err instanceof HitlError && err.code === "TIMEOUT";
    });
    expect(manager.size()).toBe(0);
  });

  it("waits without a HITL timeout when timeoutMs is omitted", async () => {
    const { promise } = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", id: "local-hitl" },
      outboundMessageId: "msg-1",
    });

    await new Promise((r) => setTimeout(r, 40));
    expect(manager.size()).toBe(1);

    manager.handleIncoming({
      channel: "fake",
      id: "local-hitl",
      messageId: "r1",
      replyToMessageId: "msg-1",
      senderId: "human",
      text: "late",
    });

    await expect(promise).resolves.toMatchObject({ text: "late" });
  });

  it("rejects all requests for a closed connection", async () => {
    const a = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", id: "local-hitl" },
      outboundMessageId: "msg-a",
    });
    const b = manager.create({
      connectionId: "conn-b",
      target: { channel: "fake", id: "local-hitl" },
      outboundMessageId: "msg-b",
    });

    const count = manager.rejectConnection("conn-a");
    expect(count).toBe(1);
    expect(manager.size()).toBe(1);
    await expect(a.promise).rejects.toSatisfy(
      (err: unknown) => err instanceof HitlError && err.code === "CONNECTION_CLOSED",
    );
    expect(manager.get(b.requestId)).toBeDefined();
    manager.clear();
  });
});

describe("Correlation", () => {
  let manager: PendingRequestManager;

  beforeEach(() => {
    manager = new PendingRequestManager();
  });

  afterEach(() => {
    manager.clear();
  });

  it("correlates an incoming reply to the correct message", async () => {
    const { promise } = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", id: "local-hitl" },
      outboundMessageId: "out-1",
    });

    const matched = manager.handleIncoming({
      channel: "fake",
      id: "local-hitl",
      messageId: "in-1",
      replyToMessageId: "out-1",
      senderId: "human",
      text: "yes",
    });

    expect(matched).toBe(true);
    await expect(promise).resolves.toMatchObject({ text: "yes" });
  });

  it("ignores unrelated messages", () => {
    manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", id: "local-hitl" },
      outboundMessageId: "out-1",
    });

    const matched = manager.handleIncoming({
      channel: "fake",
      id: "local-hitl",
      messageId: "in-unrelated",
      senderId: "human",
      text: "random chatter",
    });

    expect(matched).toBe(false);
    expect(manager.size()).toBe(1);
    manager.clear();
  });

  it("ignores WhatsApp plain messages without a quote (thread/quote-only)", () => {
    manager.create({
      connectionId: "conn-a",
      target: { channel: "whatsapp", id: "120@g.us" },
      outboundMessageId: "out-1",
    });

    const matched = manager.handleIncoming({
      channel: "whatsapp",
      id: "120@g.us",
      messageId: "in-plain",
      senderId: "human",
      text: "plain reply",
    });

    expect(matched).toBe(false);
    expect(manager.size()).toBe(1);
    manager.clear();
  });

  it("handles multiple pending requests", async () => {
    const a = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", id: "t1" },
      outboundMessageId: "out-a",
    });
    const b = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", id: "t1" },
      outboundMessageId: "out-b",
    });

    manager.handleIncoming({
      channel: "fake",
      id: "t1",
      messageId: "in-b",
      replyToMessageId: "out-b",
      senderId: "human",
      text: "answer-b",
    });
    manager.handleIncoming({
      channel: "fake",
      id: "t1",
      messageId: "in-a",
      replyToMessageId: "out-a",
      senderId: "human",
      text: "answer-a",
    });

    await expect(a.promise).resolves.toMatchObject({ text: "answer-a" });
    await expect(b.promise).resolves.toMatchObject({ text: "answer-b" });
  });
});

describe("Target resolution and overrides", () => {
  let configPath: string;
  let tmp: string;
  let fake: FakeChannelAdapter;
  let channels: ChannelManager;
  let config: HitlConfig;
  let hitl: HitlManager;
  let configManager: ConfigManager;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "hitl-mcp-"));
    configPath = join(tmp, "config.json");
    configManager = new ConfigManager(configPath);

    config = {
      defaultTarget: "fake",
      targets: [
        { channel: "fake", id: "local-hitl", label: "Local HITL" },
      ],
      channels: {
        fake: {
          enabled: true,
          targets: [
            { id: "local-hitl" },
            { id: "development" },
          ],
        },
      },
    };
    await configManager.save(config);

    fake = new FakeChannelAdapter([
      { id: "local-hitl" },
      { id: "development" },
    ]);
    await fake.authenticate();

    channels = new ChannelManager();
    channels.register(fake);

    hitl = new HitlManager(channels, () => config);
    hitl.startListening();
  });

  afterEach(async () => {
    hitl.getPendingManager().clear();
    await rm(tmp, { recursive: true, force: true });
  });

  it("uses the default target", async () => {
    const ask = hitl.askHuman({
      question: "Default?",
      connectionId: "conn-1",
      session: { id: "chat-1", name: "Chat 1" },
      timeoutMs: 2000,
    });

    // Allow send to complete (opener + question)
    await new Promise((r) => setTimeout(r, 10));
    const outbound = fake.sent.at(-1)!;
    expect(outbound.target.id).toBe("local-hitl");

    fake.simulateReply({
      replyToMessageId: outbound.correlationId ?? outbound.messageId,
      text: "ok",
    });

    const result = await ask;
    expect(result).toMatchObject({ kind: "answered", response: { text: "ok" } });
  });

  it("uses an explicit target override", async () => {
    const ask = hitl.askHuman({
      question: "Override?",
      connectionId: "conn-1",
      session: { id: "chat-1" },
      target: { channel: "fake", id: "development" },
      timeoutMs: 2000,
    });

    await new Promise((r) => setTimeout(r, 10));
    const outbound = fake.sent.at(-1)!;
    expect(outbound.target.id).toBe("development");

    fake.simulateReply({
      replyToMessageId: outbound.correlationId ?? outbound.messageId,
      text: "dev ok",
    });

    await ask;
  });

  it("does not modify persistent default when overriding", async () => {
    const before = await configManager.load();
    expect(before.defaultTarget).toBe("fake");
    expect(before.targets.find((x) => x.channel === "fake")?.id).toBe("local-hitl");

    const ask = hitl.askHuman({
      question: "Override without save?",
      connectionId: "conn-1",
      session: { id: "chat-1" },
      target: { channel: "fake", id: "development" },
      timeoutMs: 2000,
    });

    await new Promise((r) => setTimeout(r, 10));
    const last = fake.sent.at(-1)!;
    fake.simulateReply({
      replyToMessageId: last.correlationId ?? last.messageId,
      text: "done",
    });
    await ask;

    const after = await configManager.load();
    expect(after.defaultTarget).toBe("fake");
    expect(after.targets.find((x) => x.channel === "fake")?.id).toBe("local-hitl");
  });

  it("rejects when neither explicit nor default target exists", () => {
    config = { targets: [], channels: {} };
    hitl = new HitlManager(channels, () => config);

    expect(() => hitl.resolveTarget()).toThrow(HitlError);
    try {
      hitl.resolveTarget();
    } catch (error) {
      expect(error).toBeInstanceOf(HitlError);
      expect((error as HitlError).code).toBe("NO_DEFAULT_TARGET");
    }
  });

  it("notify_human sends without creating a pending request", async () => {
    const sent = await hitl.notifyHuman({
      message: "FYI",
      session: { id: "chat-1", name: "Chat 1" },
    });
    expect(sent.kind).toBe("sent");
    if (sent.kind === "sent") {
      expect(sent.message.messageId).toBeTruthy();
    }
    expect(hitl.getPendingManager().size()).toBe(0);
  });

  it("opens one session thread and keeps later messages in it", async () => {
    const ask1 = hitl.askHuman({
      question: "Q1",
      connectionId: "conn-1",
      session: { id: "chat-a", name: "Feature X" },
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(fake.sent[0]?.text).toBe("*assistant* Started working on Feature X");
    const rootId = fake.sent[0]!.messageId;
    expect(fake.sent[1]?.correlationId).toBe(rootId);

    fake.simulateReply({ replyToMessageId: rootId, text: "A1" });
    await ask1;

    const ask2 = hitl.askHuman({
      question: "Q2",
      connectionId: "conn-1",
      session: { id: "chat-a", name: "Feature X" },
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 10));

    // No second opener — same session reuses the thread.
    expect(fake.sent.filter((m) => m.text.includes("Started working on"))).toHaveLength(1);
    expect(fake.sent.at(-1)?.correlationId).toBe(rootId);

    fake.simulateReply({ replyToMessageId: rootId, text: "A2" });
    await expect(ask2).resolves.toMatchObject({ response: { text: "A2" } });
  });

  it("isolates two concurrent sessions into separate threads", async () => {
    const askA = hitl.askHuman({
      question: "From A",
      connectionId: "conn-1",
      session: { id: "session-a", name: "Chat A" },
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 10));
    const rootA = fake.getSessionRoot("local-hitl", "session-a")!.rootMessageId;

    const askB = hitl.askHuman({
      question: "From B",
      connectionId: "conn-1",
      session: { id: "session-b", name: "Chat B" },
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 10));
    const rootB = fake.getSessionRoot("local-hitl", "session-b")!.rootMessageId;

    expect(rootA).not.toBe(rootB);

    fake.simulateReply({ replyToMessageId: rootB, text: "Answer B" });
    fake.simulateReply({ replyToMessageId: rootA, text: "Answer A" });

    const [a, b] = await Promise.all([askA, askB]);
    expect(a).toMatchObject({ kind: "answered", response: { text: "Answer A" } });
    expect(b).toMatchObject({ kind: "answered", response: { text: "Answer B" } });
  });
});

describe("Connection isolation", () => {
  it("routes response B to B and response A to A", async () => {
    const fake = new FakeChannelAdapter([{ id: "local-hitl" }]);
    await fake.authenticate();
    const channels = new ChannelManager();
    channels.register(fake);

    const config: HitlConfig = {
      defaultTarget: "fake",
      targets: [{ channel: "fake", id: "local-hitl" }],
      channels: { fake: { enabled: true } },
    };
    const hitl = new HitlManager(channels, () => config);
    hitl.startListening();

    const askA = hitl.askHuman({
      question: "Question A",
      connectionId: "connection-a",
      session: { id: "session-a" },
      timeoutMs: 3000,
    });
    await new Promise((r) => setTimeout(r, 10));
    const rootA = fake.getSessionRoot("local-hitl", "session-a")!.rootMessageId;

    const askB = hitl.askHuman({
      question: "Question B",
      connectionId: "connection-b",
      session: { id: "session-b" },
      timeoutMs: 3000,
    });
    await new Promise((r) => setTimeout(r, 10));
    const rootB = fake.getSessionRoot("local-hitl", "session-b")!.rootMessageId;

    fake.simulateReply({ replyToMessageId: rootB, text: "Answer B" });
    fake.simulateReply({ replyToMessageId: rootA, text: "Answer A" });

    const [resultA, resultB] = await Promise.all([askA, askB]);
    expect(resultA).toMatchObject({ kind: "answered", response: { text: "Answer A" } });
    expect(resultB).toMatchObject({ kind: "answered", response: { text: "Answer B" } });
    expect(hitl.getPendingManager().size()).toBe(0);
  });

  it("FIFO-resolves multiple pending asks in the same session thread", async () => {
    const manager = new PendingRequestManager();

    const first = manager.create({
      connectionId: "conn",
      target: { channel: "fake", id: "t" },
      outboundMessageId: "thread-root",
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = manager.create({
      connectionId: "conn",
      target: { channel: "fake", id: "t" },
      outboundMessageId: "thread-root",
    });

    manager.handleIncoming({
      channel: "fake",
      id: "t",
      messageId: "in-1",
      replyToMessageId: "thread-root",
      senderId: "human",
      text: "first reply",
    });
    manager.handleIncoming({
      channel: "fake",
      id: "t",
      messageId: "in-2",
      replyToMessageId: "thread-root",
      senderId: "human",
      text: "second reply",
    });

    await expect(first.promise).resolves.toMatchObject({ text: "first reply" });
    await expect(second.promise).resolves.toMatchObject({ text: "second reply" });
  });

  it("ignores cross-connection confusion when correlating by message id", async () => {
    const manager = new PendingRequestManager();

    const a = manager.create({
      connectionId: "connection-a",
      target: { channel: "fake", id: "t" },
      outboundMessageId: "out-a",
    });
    const b = manager.create({
      connectionId: "connection-b",
      target: { channel: "fake", id: "t" },
      outboundMessageId: "out-b",
    });

    manager.handleIncoming({
      channel: "fake",
      id: "t",
      messageId: "in-b",
      replyToMessageId: "out-b",
      senderId: "human",
      text: "for-b",
    });

    await expect(b.promise).resolves.toMatchObject({ text: "for-b" });
    expect(manager.get(a.requestId)?.connectionId).toBe("connection-a");
    manager.clear();
  });
});

describe("FakeChannelAdapter", () => {
  it("simulates send, reply, and unrelated messages", async () => {
    const fake = new FakeChannelAdapter([
      { id: "a" },
      { id: "b" },
    ]);
    await fake.authenticate();
    await fake.connect();

    const received: string[] = [];
    fake.onMessage((m) => received.push(m.text));

    const sent = await fake.sendMessage("a", "hello");
    fake.simulateReply({ replyToMessageId: sent.messageId, text: "hi back" });

    await fake.sendMessage("a", "follow-up");
    fake.simulateReplyToLast("reply to last");

    fake.simulateUnrelatedMessage({ id: "a", text: "noise" });

    expect(fake.sent).toHaveLength(2);
    expect(received).toEqual(["hi back", "reply to last", "noise"]);

    const targets = await fake.listTargets();
    expect(targets.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
