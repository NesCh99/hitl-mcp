import type {
  ChannelAdapter,
  ListedTarget,
  MessageHandler,
} from "../channel-adapter.js";
import type { ChannelType, SentMessage } from "../../core/types.js";
import { HitlError } from "../../core/types.js";

/**
 * WhatsApp adapter scaffold. MVP uses FakeChannelAdapter for core validation.
 * Real local WhatsApp session integration is a later milestone.
 *
 * Does NOT store WhatsApp message history — only enough runtime info to
 * resolve currently active ask_human() calls.
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly type: ChannelType = "whatsapp";

  private readonly handlers: MessageHandler[] = [];

  async authenticate(): Promise<void> {
    throw new HitlError(
      "PROVIDER_NOT_CONFIGURED",
      "WhatsApp authentication is not implemented yet. Use the fake channel for MVP.",
    );
  }

  async isAuthenticated(): Promise<boolean> {
    return false;
  }

  async connect(): Promise<void> {
    throw new HitlError(
      "PROVIDER_NOT_CONFIGURED",
      "WhatsApp connection is not implemented yet.",
    );
  }

  async disconnect(): Promise<void> {
    // no-op until implemented
  }

  async listTargets(): Promise<ListedTarget[]> {
    return [];
  }

  async sendMessage(
    _targetId: string,
    _message: string,
    _options?: import("../../core/types.js").SendMessageOptions,
  ): Promise<SentMessage> {
    throw new HitlError(
      "PROVIDER_NOT_CONFIGURED",
      "WhatsApp sendMessage is not implemented yet.",
    );
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }
}
