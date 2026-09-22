import type { ChannelManager } from "../channels/channel-manager.js";
import type { HitlConfig } from "../config/config-schema.js";
import { PendingRequestManager } from "./pending-request-manager.js";
import {
  HitlError,
  type IncomingMessage,
  type SentMessage,
  type Target,
} from "./types.js";

export interface AskHumanInput {
  question: string;
  connectionId: string;
  target?: Target;
  timeoutMs?: number;
}

export interface NotifyHumanInput {
  message: string;
  target?: Target;
}

export interface AskHumanResult {
  requestId: string;
  response: IncomingMessage;
}

const DEFAULT_ASK_TIMEOUT_MS = 5 * 60 * 1000;

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

  /**
   * Attach incoming-message routing once adapters are registered.
   * Safe to call multiple times.
   */
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
      sent = await adapter.sendMessage(target.targetId, input.question);
    } catch (error) {
      throw new HitlError(
        "CONNECTION_FAILURE",
        `Failed to send message via ${target.channel}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const timeoutMs = input.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
    const { requestId, promise } = this.pending.create({
      connectionId: input.connectionId,
      target,
      outboundMessageId: sent.messageId,
      timeoutMs,
    });

    const response = await promise;
    return { requestId, response };
  }

  async notifyHuman(input: NotifyHumanInput): Promise<SentMessage> {
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
      return await adapter.sendMessage(target.targetId, input.message);
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
