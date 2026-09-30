import type { ChannelManager } from "../channels/channel-manager.js";
import type { HitlConfig } from "../config/config-schema.js";
import {
  findTarget,
  listTargetChannels,
  toSendTarget,
} from "../config/merge-config.js";
import { PendingRequestManager } from "./pending-request-manager.js";
import {
  SessionPrefsStore,
  type SessionPrefs,
  type SessionPrefsPatch,
} from "./session-prefs.js";
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
  /** Explicit destination; beats session channel and config default. */
  target?: Target;
  /**
   * Optional timeout in milliseconds.
   * When omitted, HITL waits until the human replies or the MCP connection closes.
   */
  timeoutMs?: number;
  /** When the MCP client cancels/times out the tool call, abort this ask. */
  signal?: AbortSignal;
}

export interface NotifyHumanInput {
  message: string;
  session: SessionRef;
  /** Explicit destination; beats session channel and config default. */
  target?: Target;
}

export interface AskHumanResult {
  requestId: string;
  response: IncomingMessage;
}

export type AskHumanOutcome =
  | { kind: "answered"; requestId: string; response: IncomingMessage }
  | { kind: "skipped"; reason: "disabled"; message: string };

export type NotifyHumanOutcome =
  | { kind: "sent"; message: SentMessage }
  | { kind: "skipped"; reason: "disabled"; message: string };

const DISABLED_MESSAGE =
  "HITL is disabled for this chat (/hitl.off). Continue without notify_human / ask_human until /hitl.on.";

/**
 * HITL core: ephemeral human communication and correlation.
 */
export class HitlManager {
  private readonly pending = new PendingRequestManager();
  private readonly sessionPrefs = new SessionPrefsStore();
  private messageHandlerAttached = false;

  constructor(
    private readonly channels: ChannelManager,
    private readonly getConfig: () => HitlConfig,
  ) {}

  getPendingManager(): PendingRequestManager {
    return this.pending;
  }

  getSessionPrefs(sessionId: string): SessionPrefs {
    return this.sessionPrefs.get(sessionId);
  }

  configureSession(sessionId: string, patch: SessionPrefsPatch): SessionPrefs {
    if (!sessionId.trim()) {
      throw new HitlError(
        "INVALID_TARGET",
        "session id is required to configure HITL for a chat.",
      );
    }

    if (patch.channel) {
      const config = this.getConfig();
      if (!findTarget(config, patch.channel)) {
        throw new HitlError(
          "UNKNOWN_TARGET_NAME",
          `No target configured for channel "${patch.channel}". Known: ${formatTargetChannels(config)}.`,
        );
      }
    }

    return this.sessionPrefs.configure(sessionId, patch);
  }

  listTargetChannels(): string[] {
    return listTargetChannels(this.getConfig());
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

  /**
   * Resolve destination for a call.
   * Order: explicit target → session channel → config.defaultTarget.
   */
  resolveTarget(override?: Target, sessionId?: string): Target {
    if (override) {
      this.validateTarget(override);
      return override;
    }

    const config = this.getConfig();
    const prefs = sessionId ? this.sessionPrefs.get(sessionId) : undefined;
    const channel = prefs?.channel ?? config.defaultTarget;

    if (!channel) {
      throw new HitlError(
        "NO_DEFAULT_TARGET",
        "No default target configured. Run `hitl-mcp setup` or pass an explicit target.",
      );
    }

    const named = findTarget(config, channel);
    if (!named) {
      throw new HitlError(
        "UNKNOWN_TARGET_NAME",
        `No target configured for channel "${channel}". Known: ${formatTargetChannels(config)}.`,
      );
    }

    const target = toSendTarget(named);
    this.validateTarget(target);
    return target;
  }

  async askHuman(input: AskHumanInput): Promise<AskHumanOutcome> {
    this.validateSession(input.session);

    const prefs = this.sessionPrefs.get(input.session.id);
    if (!prefs.enabled) {
      return { kind: "skipped", reason: "disabled", message: DISABLED_MESSAGE };
    }

    this.startListening();

    const target = this.resolveTarget(input.target, input.session.id);
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
      sent = await adapter.sendMessage(target.id, input.question, {
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

    const signal = input.signal;
    if (signal) {
      const cancel = () => {
        queueMicrotask(() => {
          this.pending.reject(
            requestId,
            new HitlError(
              "CONNECTION_CLOSED",
              "ask_human was cancelled before a human reply arrived.",
            ),
          );
        });
      };
      if (signal.aborted) {
        cancel();
      } else {
        signal.addEventListener("abort", cancel, { once: true });
        void promise.finally(() => {
          signal.removeEventListener("abort", cancel);
        });
      }
    }

    const response = await promise;
    return { kind: "answered", requestId, response };
  }

  async notifyHuman(input: NotifyHumanInput): Promise<NotifyHumanOutcome> {
    this.validateSession(input.session);

    const prefs = this.sessionPrefs.get(input.session.id);
    if (!prefs.enabled) {
      return { kind: "skipped", reason: "disabled", message: DISABLED_MESSAGE };
    }

    const target = this.resolveTarget(input.target, input.session.id);
    const adapter = this.channels.getAdapter(target.channel);

    if (!(await adapter.isAuthenticated())) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        `Channel "${target.channel}" is not authenticated. Run \`hitl-mcp setup\`.`,
      );
    }

    // Outbound only — adapters that need a live session (e.g. WhatsApp) connect
    // inside sendMessage. Slack notify uses Web API and must not start Socket Mode.
    try {
      const message = await adapter.sendMessage(target.id, input.message, {
        session: input.session,
      });
      return { kind: "sent", message };
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
    if (!target.channel || !target.id) {
      throw new HitlError(
        "INVALID_TARGET",
        "Target must include both channel and id.",
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

function formatTargetChannels(config: HitlConfig): string {
  const names = listTargetChannels(config);
  return names.length > 0 ? names.join(", ") : "(none)";
}
