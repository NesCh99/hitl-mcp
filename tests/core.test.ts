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
      target: { channel: "fake", targetId: "local-hitl" },
      outboundMessageId: "msg-1",
    });

    expect(requestId).toBeTruthy();
    expect(manager.size()).toBe(1);
    expect(manager.get(requestId)?.outboundMessageId).toBe("msg-1");
  });

  it("resolves a pending request", async () => {
    const { requestId, promise } = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", targetId: "local-hitl" },
      outboundMessageId: "msg-1",
    });

    const ok = manager.resolve(requestId, {
      channel: "fake",
      targetId: "local-hitl",
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
      target: { channel: "fake", targetId: "local-hitl" },
      outboundMessageId: "msg-1",
    });

    manager.reject(requestId, new Error("boom"));
    expect(manager.size()).toBe(0);
    await expect(promise).rejects.toThrow("boom");
  });

  it("times out and cleans up", async () => {
    const { promise } = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", targetId: "local-hitl" },
      outboundMessageId: "msg-1",
      timeoutMs: 30,
    });

    await expect(promise).rejects.toSatisfy((err: unknown) => {
      return err instanceof HitlError && err.code === "TIMEOUT";
    });
    expect(manager.size()).toBe(0);
  });

  it("rejects all requests for a closed connection", async () => {
    const a = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", targetId: "local-hitl" },
      outboundMessageId: "msg-a",
    });
    const b = manager.create({
      connectionId: "conn-b",
      target: { channel: "fake", targetId: "local-hitl" },
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
      target: { channel: "fake", targetId: "local-hitl" },
      outboundMessageId: "out-1",
    });

    const matched = manager.handleIncoming({
      channel: "fake",
      targetId: "local-hitl",
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
      target: { channel: "fake", targetId: "local-hitl" },
      outboundMessageId: "out-1",
    });

    const matched = manager.handleIncoming({
      channel: "fake",
      targetId: "local-hitl",
      messageId: "in-unrelated",
      senderId: "human",
      text: "random chatter",
    });

    expect(matched).toBe(false);
    expect(manager.size()).toBe(1);
    manager.clear();
  });

  it("handles multiple pending requests", async () => {
    const a = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", targetId: "t1" },
      outboundMessageId: "out-a",
    });
    const b = manager.create({
      connectionId: "conn-a",
      target: { channel: "fake", targetId: "t1" },
      outboundMessageId: "out-b",
    });

    manager.handleIncoming({
      channel: "fake",
      targetId: "t1",
      messageId: "in-b",
      replyToMessageId: "out-b",
      senderId: "human",
      text: "answer-b",
    });
    manager.handleIncoming({
      channel: "fake",
      targetId: "t1",
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
      defaultTarget: { channel: "fake", targetId: "local-hitl" },
      channels: {
        fake: {
          enabled: true,
          targets: [
            { targetId: "local-hitl" },
            { targetId: "development" },
          ],
        },
      },
    };
    await configManager.save(config);

    fake = new FakeChannelAdapter([
      { targetId: "local-hitl" },
      { targetId: "development" },
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
      timeoutMs: 2000,
    });

    // Allow send to complete
    await new Promise((r) => setTimeout(r, 10));
    const outbound = fake.sent.at(-1)!;
    expect(outbound.target.targetId).toBe("local-hitl");

    fake.simulateReply({
      replyToMessageId: outbound.messageId,
      text: "ok",
    });

    const result = await ask;
    expect(result.response.text).toBe("ok");
  });

  it("uses an explicit target override", async () => {
    const ask = hitl.askHuman({
      question: "Override?",
      connectionId: "conn-1",
      target: { channel: "fake", targetId: "development" },
      timeoutMs: 2000,
    });

    await new Promise((r) => setTimeout(r, 10));
    const outbound = fake.sent.at(-1)!;
    expect(outbound.target.targetId).toBe("development");

    fake.simulateReply({
      replyToMessageId: outbound.messageId,
      text: "dev ok",
    });

    await ask;
  });

  it("does not modify persistent default when overriding", async () => {
    const before = await configManager.load();
    expect(before.defaultTarget?.targetId).toBe("local-hitl");

    const ask = hitl.askHuman({
      question: "Override without save?",
      connectionId: "conn-1",
      target: { channel: "fake", targetId: "development" },
      timeoutMs: 2000,
    });

    await new Promise((r) => setTimeout(r, 10));
    fake.simulateReply({
      replyToMessageId: fake.sent.at(-1)!.messageId,
      text: "done",
    });
    await ask;

    const after = await configManager.load();
    expect(after.defaultTarget?.targetId).toBe("local-hitl");
  });

  it("rejects when neither explicit nor default target exists", () => {
    config = { channels: {} };
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
    const sent = await hitl.notifyHuman({ message: "FYI" });
    expect(sent.messageId).toBeTruthy();
    expect(hitl.getPendingManager().size()).toBe(0);
  });
});

describe("Connection isolation", () => {
  it("routes response B to B and response A to A", async () => {
    const fake = new FakeChannelAdapter([{ targetId: "local-hitl" }]);
    await fake.authenticate();
    const channels = new ChannelManager();
    channels.register(fake);

    const config: HitlConfig = {
      defaultTarget: { channel: "fake", targetId: "local-hitl" },
      channels: { fake: { enabled: true } },
    };
    const hitl = new HitlManager(channels, () => config);
    hitl.startListening();

    const askA = hitl.askHuman({
      question: "Question A",
      connectionId: "connection-a",
      timeoutMs: 3000,
    });
    await new Promise((r) => setTimeout(r, 10));
    const msgA = fake.sent[0]!;

    const askB = hitl.askHuman({
      question: "Question B",
      connectionId: "connection-b",
      timeoutMs: 3000,
    });
    await new Promise((r) => setTimeout(r, 10));
    const msgB = fake.sent[1]!;

    // Reply to B first, then A — order must not matter
    fake.simulateReply({ replyToMessageId: msgB.messageId, text: "Answer B" });
    fake.simulateReply({ replyToMessageId: msgA.messageId, text: "Answer A" });

    const [resultA, resultB] = await Promise.all([askA, askB]);
    expect(resultA.response.text).toBe("Answer A");
    expect(resultB.response.text).toBe("Answer B");
    expect(hitl.getPendingManager().size()).toBe(0);
  });

  it("ignores cross-connection confusion when correlating by message id", async () => {
    const manager = new PendingRequestManager();

    const a = manager.create({
      connectionId: "connection-a",
      target: { channel: "fake", targetId: "t" },
      outboundMessageId: "out-a",
    });
    const b = manager.create({
      connectionId: "connection-b",
      target: { channel: "fake", targetId: "t" },
      outboundMessageId: "out-b",
    });

    manager.handleIncoming({
      channel: "fake",
      targetId: "t",
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
      { targetId: "a" },
      { targetId: "b" },
    ]);
    await fake.authenticate();
    await fake.connect();

    const received: string[] = [];
    fake.onMessage((m) => received.push(m.text));

    const sent = await fake.sendMessage("a", "hello");
    fake.simulateReply({ replyToMessageId: sent.messageId, text: "hi back" });
    fake.simulateUnrelatedMessage({ targetId: "a", text: "noise" });

    expect(fake.sent).toHaveLength(1);
    expect(received).toEqual(["hi back", "noise"]);

    const targets = await fake.listTargets();
    expect(targets.map((t) => t.targetId)).toEqual(["a", "b"]);
  });
});
