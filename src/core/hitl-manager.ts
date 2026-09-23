import type { ChannelManager } from "../channels/channel-manager.js";
import type { HitlConfig } from "../config/config-schema.js";
import { PendingRequestManager } from "./pending-request-manager.js";
import {
  HitlError,
  type IncomingMessage,
  type SentMessage,
  type SessionRef,
  type Target,
} from "./types.js";

export interface AskHumanInput {
  question: string;
  connectionId: string;
  /** Agent chat/session — opens one provider thread per session when supported. */
  session: SessionRef;
  target?: Target;
  /**
   * Optional timeout in milliseconds.
   * When omitted, HITL waits until the human replies or the MCP connection closes.
   */
  timeoutMs?: number;
}

export interface NotifyHumanInput {
  message: string;
  session: SessionRef;
  target?: Target;
}

export interface AskHumanResult {
  requestId: string;
  response: IncomingMessage;
}

/**
 * HITL core: ephemeral human communication and correlation only.
 * No provider-specific knowledge. No task or agent state.
 */
export class HitlManager {
  private readonly pending = new PendingRequestManager();
  private messageHandlerAttached = false;

  constructor(
    private readonly channels: ChannelManager,
    private readonly getConfig: () => HitlConfig,
  ) {}

  getPendingManager(): PendingRequestManager {
    return this.pending;
  }

  startListening(): void {
    if (this.messageHandlerAttached) {
      return;
    }
    this.messageHandlerAttached = true;

    for (const adapter of this.channels.listAdapters()) {
      adapter.onMessage((message) => {
        this.pending.handleIncoming(message);
      });
    }
  }

  resolveTarget(override?: Target): Target {
    if (override) {
      this.validateTarget(override);
      return override;
    }

    const config = this.getConfig();
    if (!config.defaultTarget) {
      throw new HitlError(
        "NO_DEFAULT_TARGET",
        "No default target configured. Run `hitl-mcp setup` or pass an explicit target.",
      );
    }

    this.validateTarget(config.defaultTarget);
    return config.defaultTarget;
  }

  async askHuman(input: AskHumanInput): Promise<AskHumanResult> {
    this.startListening();
    this.validateSession(input.session);

    const target = this.resolveTarget(input.target);
    const adapter = this.channels.getAdapter(target.channel);

    if (!(await adapter.isAuthenticated())) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        `Channel "${target.channel}" is not authenticated. Run \`hitl-mcp setup\`.`,
      );
    }

    await adapter.connect();

    let sent: SentMessage;
    try {
      sent = await adapter.sendMessage(target.targetId, input.question, {
        session: input.session,
      });
    } catch (error) {
      throw new HitlError(
        "CONNECTION_FAILURE",
        `Failed to send message via ${target.channel}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const { requestId, promise } = this.pending.create({
      connectionId: input.connectionId,
      target,
      outboundMessageId: sent.correlationId ?? sent.messageId,
      sessionId: input.session.id,
      question: input.question,
      timeoutMs: input.timeoutMs,
    });

    const response = await promise;
    return { requestId, response };
  }

  async notifyHuman(input: NotifyHumanInput): Promise<SentMessage> {
    this.validateSession(input.session);

    const target = this.resolveTarget(input.target);
    const adapter = this.channels.getAdapter(target.channel);

    if (!(await adapter.isAuthenticated())) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        `Channel "${target.channel}" is not authenticated. Run \`hitl-mcp setup\`.`,
      );
    }

    await adapter.connect();

    try {
      return await adapter.sendMessage(target.targetId, input.message, {
        session: input.session,
      });
    } catch (error) {
      throw new HitlError(
        "CONNECTION_FAILURE",
        `Failed to send notification via ${target.channel}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  onConnectionClosed(connectionId: string): void {
    this.pending.rejectConnection(connectionId);
  }

  private validateSession(session: SessionRef): void {
    if (!session.id || session.id.trim().length === 0) {
      throw new HitlError(
        "INVALID_TARGET",
        "session.id is required so concurrent threads can stay separate.",
      );
    }
  }

  private validateTarget(target: Target): void {
    if (!target.channel || !target.targetId) {
      throw new HitlError(
        "INVALID_TARGET",
        "Target must include both channel and targetId.",
      );
    }

    if (!this.channels.has(target.channel)) {
      throw new HitlError(
        "PROVIDER_NOT_CONFIGURED",
        `Channel "${target.channel}" is not available.`,
      );
    }
  }
}
