import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelManager } from "../src/channels/channel-manager.js";
import { FakeChannelAdapter } from "../src/channels/fake/fake-channel-adapter.js";
import type { HitlConfig } from "../src/config/config-schema.js";
import { HitlManager } from "../src/core/hitl-manager.js";
import { HitlError } from "../src/core/types.js";

function createTestHitl() {
  const fake = new FakeChannelAdapter([{ targetId: "local-hitl" }]);
  const channels = new ChannelManager();
  channels.register(fake);

  const config: HitlConfig = {
    defaultTarget: { channel: "fake", targetId: "local-hitl" },
    channels: { fake: { enabled: true } },
  };

  const hitl = new HitlManager(channels, () => config);
  hitl.startListening();

  return { fake, hitl };
}

async function waitForSent(fake: FakeChannelAdapter, count: number): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (fake.sent.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Expected ${count} sent message(s), got ${fake.sent.length}`);
}

describe("ask_human end-to-end flow", () => {
  let fake: FakeChannelAdapter;
  let hitl: HitlManager;

  beforeEach(async () => {
    ({ fake, hitl } = createTestHitl());
    await fake.authenticate();
  });

  afterEach(() => {
    hitl.getPendingManager().clear();
  });

  it("resolves with the human reply and clears the pending request", async () => {
    const ask = hitl.askHuman({
      question: "¿Debo crear la rama feature/x?",
      connectionId: "conn-1",
      session: { id: "chat-1", name: "feature/x" },
      timeoutMs: 5000,
    });

    // opener + question
    await waitForSent(fake, 2);
    expect(fake.sent[0]?.text).toBe("Started working on feature/x");
    const outbound = fake.getLastSentMessage()!;
    expect(outbound.text).toBe("¿Debo crear la rama feature/x?");
    expect(hitl.getPendingManager().size()).toBe(1);

    fake.simulateReplyToLast("sí");

    const result = await ask;
    expect(result.response.text).toBe("sí");
    expect(hitl.getPendingManager().size()).toBe(0);
  });

  it("correlates each reply to the correct session when two chats are pending", async () => {
    const askA = hitl.askHuman({
      question: "Question A",
      connectionId: "conn-a",
      session: { id: "chat-a", name: "Chat A" },
      timeoutMs: 5000,
    });
    await waitForSent(fake, 2);
    const rootA = fake.getSessionRoot("local-hitl", "chat-a")!.rootMessageId;

    const askB = hitl.askHuman({
      question: "Question B",
      connectionId: "conn-b",
      session: { id: "chat-b", name: "Chat B" },
      timeoutMs: 5000,
    });
    await waitForSent(fake, 4);
    const rootB = fake.getSessionRoot("local-hitl", "chat-b")!.rootMessageId;

    expect(hitl.getPendingManager().size()).toBe(2);

    fake.simulateReply({ replyToMessageId: rootB, text: "Answer B" });
    fake.simulateReply({ replyToMessageId: rootA, text: "Answer A" });

    const [resultA, resultB] = await Promise.all([askA, askB]);
    expect(resultA.response.text).toBe("Answer A");
    expect(resultB.response.text).toBe("Answer B");
    expect(hitl.getPendingManager().size()).toBe(0);
  });

  it("times out and removes the pending request", async () => {
    const ask = hitl.askHuman({
      question: "¿Debo crear la rama feature/x?",
      connectionId: "conn-1",
      session: { id: "chat-1" },
      timeoutMs: 50,
    });

    await waitForSent(fake, 2);
    expect(hitl.getPendingManager().size()).toBe(1);

    await expect(ask).rejects.toSatisfy((err: unknown) => {
      return err instanceof HitlError && err.code === "TIMEOUT";
    });
    expect(hitl.getPendingManager().size()).toBe(0);
  });

  it("cleans up pending requests when the MCP connection closes", async () => {
    const ask = hitl.askHuman({
      question: "¿Debo crear la rama feature/x?",
      connectionId: "conn-mcp",
      session: { id: "chat-1" },
      timeoutMs: 5000,
    });

    await waitForSent(fake, 2);
    expect(hitl.getPendingManager().size()).toBe(1);

    hitl.onConnectionClosed("conn-mcp");

    await expect(ask).rejects.toSatisfy((err: unknown) => {
      return err instanceof HitlError && err.code === "CONNECTION_CLOSED";
    });
    expect(hitl.getPendingManager().size()).toBe(0);
  });
});
