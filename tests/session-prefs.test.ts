import { beforeEach, describe, expect, it } from "vitest";
import { ChannelManager } from "../src/channels/channel-manager.js";
import { FakeChannelAdapter } from "../src/channels/fake/fake-channel-adapter.js";
import { HitlManager } from "../src/core/hitl-manager.js";
import { HitlError } from "../src/core/types.js";
import { fakeHitlConfig } from "./helpers/config.js";

describe("session prefs and channel selection", () => {
  let fake: FakeChannelAdapter;
  let hitl: HitlManager;

  beforeEach(async () => {
    fake = new FakeChannelAdapter([
      { id: "local-hitl" },
      { id: "development" },
    ]);
    await fake.authenticate();
    const channels = new ChannelManager();
    channels.register(fake);

    const config = fakeHitlConfig();
    hitl = new HitlManager(channels, () => config);
    hitl.startListening();
  });

  it("soft-skips ask and notify when /hitl.off", async () => {
    hitl.configureSession("chat-1", { enabled: false });

    const notify = await hitl.notifyHuman({
      message: "should not send",
      session: { id: "chat-1" },
    });
    expect(notify).toMatchObject({ kind: "skipped", reason: "disabled" });
    expect(fake.sent).toHaveLength(0);

    const ask = await hitl.askHuman({
      question: "should not ask",
      connectionId: "conn",
      session: { id: "chat-1" },
      timeoutMs: 500,
    });
    expect(ask).toMatchObject({ kind: "skipped", reason: "disabled" });
    expect(fake.sent).toHaveLength(0);
    expect(hitl.getPendingManager().size()).toBe(0);
  });

  it("uses session channel from /hitl-channel.*", async () => {
    hitl.configureSession("chat-1", { channel: "fake" });

    const ask = hitl.askHuman({
      question: "routed?",
      connectionId: "conn",
      session: { id: "chat-1" },
      timeoutMs: 2000,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.sent.at(-1)?.target.id).toBe("local-hitl");

    fake.simulateReplyToLast("ok");
    await expect(ask).resolves.toMatchObject({
      kind: "answered",
      response: { text: "ok" },
    });
  });

  it("clears session channel back to default", async () => {
    hitl.configureSession("chat-1", { channel: "fake" });
    hitl.configureSession("chat-1", { channel: null });

    expect(hitl.resolveTarget(undefined, "chat-1").id).toBe("local-hitl");
  });

  it("rejects unknown channels", () => {
    expect(() =>
      hitl.configureSession("chat-1", { channel: "slack" }),
    ).toThrow(HitlError);
    try {
      hitl.configureSession("chat-1", { channel: "slack" });
    } catch (error) {
      expect((error as HitlError).code).toBe("UNKNOWN_TARGET_NAME");
    }
  });

  it("re-enables after /hitl.on", async () => {
    hitl.configureSession("chat-1", { enabled: false });
    hitl.configureSession("chat-1", { enabled: true });

    const notify = await hitl.notifyHuman({
      message: "back on",
      session: { id: "chat-1" },
    });
    expect(notify.kind).toBe("sent");
    expect(fake.sent.length).toBeGreaterThan(0);
  });
});
