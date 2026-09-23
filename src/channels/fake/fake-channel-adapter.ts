import { randomUUID } from "node:crypto";
import type {
  MessageHandler,
  ChannelAdapter,
  ListedTarget,
} from "../channel-adapter.js";
import type {
  ChannelType,
  IncomingMessage,
  SendMessageOptions,
  SentMessage,
  SessionRef,
} from "../../core/types.js";
import { HitlError } from "../../core/types.js";

export interface FakeTargetOption {
  targetId: string;
  label?: string;
}

interface FakeSessionThread {
  targetId: string;
  sessionId: string;
  rootMessageId: string;
  label: string;
}

/**
 * Development/test adapter. Simulates send/receive, message IDs, and replies
 * without any external provider.
 *
 * With `session`, mirrors Slack: one opener root per session, then messages
 * in that "thread" correlated via `correlationId` (= root id).
 */
export class FakeChannelAdapter implements ChannelAdapter {
  readonly type: ChannelType = "fake";

  private authenticated = false;
  private connected = false;
  private readonly handlers: MessageHandler[] = [];
  private readonly targets: FakeTargetOption[];
  private messageCounter = 0;
  private readonly sessions = new Map<string, FakeSessionThread>();

  /** Outbound messages for test assertions (includes session openers). */
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
    this.sessions.clear();
  }

  async listTargets(): Promise<ListedTarget[]> {
    return this.targets.map((t) => ({
      channel: this.type,
      targetId: t.targetId,
      label: t.label ?? t.targetId,
    }));
  }

  async sendMessage(
    targetId: string,
    message: string,
    options?: SendMessageOptions,
  ): Promise<SentMessage> {
    if (!this.connected) {
      throw new HitlError("CONNECTION_FAILURE", "Fake channel is not connected.");
    }

    if (!this.targets.some((t) => t.targetId === targetId)) {
      throw new HitlError(
        "TARGET_NOT_FOUND",
        `Fake target "${targetId}" not found.`,
      );
    }

    const session = options?.session;
    if (session?.id) {
      const thread = this.ensureSession(targetId, session);
      this.messageCounter += 1;
      const sent: SentMessage = {
        messageId: `fake-msg-${this.messageCounter}`,
        correlationId: thread.rootMessageId,
        target: { channel: this.type, targetId },
        text: message,
      };
      this.sent.push(sent);
      return sent;
    }

    // Legacy path (no session): each message is its own correlation root.
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

  getLastSentMessage(): SentMessage | undefined {
    return this.sent.at(-1);
  }

  getSessionRoot(targetId: string, sessionId: string): FakeSessionThread | undefined {
    return this.sessions.get(`${targetId}::${sessionId}`);
  }

  /**
   * Simulate a human reply to the most recently sent message.
   * Uses correlationId when present (session thread), else messageId.
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
      replyToMessageId: outbound.correlationId ?? outbound.messageId,
      text,
      senderId,
    });
  }

  /**
   * Simulate a human reply. Sets replyToMessageId so core correlation works.
   */
  simulateReply(options: {
    replyToMessageId: string;
    text: string;
    senderId?: string;
    targetId?: string;
  }): IncomingMessage {
    const outbound = this.sent.find(
      (m) =>
        m.messageId === options.replyToMessageId ||
        m.correlationId === options.replyToMessageId,
    );
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
    this.sessions.clear();
  }

  private ensureSession(targetId: string, session: SessionRef): FakeSessionThread {
    const key = `${targetId}::${session.id}`;
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const label = session.name?.trim() || session.id;
    this.messageCounter += 1;
    const rootMessageId = `fake-msg-${this.messageCounter}`;
    const opener: SentMessage = {
      messageId: rootMessageId,
      correlationId: rootMessageId,
      target: { channel: this.type, targetId },
      text: `Started working on ${label}`,
    };
    this.sent.push(opener);

    const thread: FakeSessionThread = {
      targetId,
      sessionId: session.id,
      rootMessageId,
      label,
    };
    this.sessions.set(key, thread);
    return thread;
  }

  private deliver(message: IncomingMessage): void {
    for (const handler of this.handlers) {
      handler(message);
    }
  }
}
