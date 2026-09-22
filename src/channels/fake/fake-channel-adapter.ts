import { randomUUID } from "node:crypto";
import type {
  MessageHandler,
  ChannelAdapter,
  ListedTarget,
} from "../channel-adapter.js";
import type {
  ChannelType,
  IncomingMessage,
  SentMessage,
} from "../../core/types.js";
import { HitlError } from "../../core/types.js";

export interface FakeTargetOption {
  targetId: string;
  label?: string;
}

/**
 * Development/test adapter. Simulates send/receive, message IDs, and replies
 * without any external provider.
 */
export class FakeChannelAdapter implements ChannelAdapter {
  readonly type: ChannelType = "fake";

  private authenticated = false;
  private connected = false;
  private readonly handlers: MessageHandler[] = [];
  private readonly targets: FakeTargetOption[];
  private messageCounter = 0;

  /** Outbound messages for test assertions. */
  readonly sent: SentMessage[] = [];

  constructor(targets: FakeTargetOption[] = [{ targetId: "local-hitl", label: "Local HITL" }]) {
    this.targets = targets;
  }

  async authenticate(): Promise<void> {
    this.authenticated = true;
  }

  async isAuthenticated(): Promise<boolean> {
    return this.authenticated;
  }

  async connect(): Promise<void> {
    if (!this.authenticated) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        "Fake channel is not authenticated.",
      );
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async listTargets(): Promise<ListedTarget[]> {
    return this.targets.map((t) => ({
      channel: this.type,
      targetId: t.targetId,
      label: t.label ?? t.targetId,
    }));
  }

  async sendMessage(targetId: string, message: string): Promise<SentMessage> {
    if (!this.connected) {
      throw new HitlError("CONNECTION_FAILURE", "Fake channel is not connected.");
    }

    if (!this.targets.some((t) => t.targetId === targetId)) {
      throw new HitlError(
        "TARGET_NOT_FOUND",
        `Fake target "${targetId}" not found.`,
      );
    }

    this.messageCounter += 1;
    const sent: SentMessage = {
      messageId: `fake-msg-${this.messageCounter}`,
      target: { channel: this.type, targetId },
      text: message,
    };
    this.sent.push(sent);
    return sent;
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Most recently sent outbound message, if any.
   * Useful in tests to correlate a simulated human reply.
   */
  getLastSentMessage(): SentMessage | undefined {
    return this.sent.at(-1);
  }

  /**
   * Simulate a human reply to the most recently sent message.
   * Same delivery path as simulateReply — mirrors replying to the latest question.
   */
  simulateReplyToLast(text: string, senderId?: string): IncomingMessage {
    const outbound = this.getLastSentMessage();
    if (!outbound) {
      throw new HitlError(
        "CORRELATION_FAILURE",
        "No outbound messages to reply to.",
      );
    }
    return this.simulateReply({
      replyToMessageId: outbound.messageId,
      text,
      senderId,
    });
  }

  /**
   * Simulate a human reply to a previously sent message.
   * Sets replyToMessageId so core correlation can resolve the pending request.
   */
  simulateReply(options: {
    replyToMessageId: string;
    text: string;
    senderId?: string;
    targetId?: string;
  }): IncomingMessage {
    const outbound = this.sent.find((m) => m.messageId === options.replyToMessageId);
    if (!outbound && !options.targetId) {
      throw new HitlError(
        "CORRELATION_FAILURE",
        `No outbound message with id "${options.replyToMessageId}".`,
      );
    }

    const targetId = options.targetId ?? outbound!.target.targetId;
    const message: IncomingMessage = {
      channel: this.type,
      targetId,
      messageId: randomUUID(),
      replyToMessageId: options.replyToMessageId,
      senderId: options.senderId ?? "fake-human",
      text: options.text,
    };

    this.deliver(message);
    return message;
  }

  /**
   * Deliver an unrelated (non-reply) message — should not resolve pending asks.
   */
  simulateUnrelatedMessage(options: {
    targetId: string;
    text: string;
    senderId?: string;
  }): IncomingMessage {
    const message: IncomingMessage = {
      channel: this.type,
      targetId: options.targetId,
      messageId: randomUUID(),
      senderId: options.senderId ?? "fake-human",
      text: options.text,
    };
    this.deliver(message);
    return message;
  }

  reset(): void {
    this.sent.length = 0;
    this.messageCounter = 0;
    this.authenticated = false;
    this.connected = false;
  }

  private deliver(message: IncomingMessage): void {
    for (const handler of this.handlers) {
      handler(message);
    }
  }
}
