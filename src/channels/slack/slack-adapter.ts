import type { ChannelAdapter, MessageHandler } from "../channel-adapter.js";
import type {
  ChannelType,
  SentMessage,
  Target,
} from "../../core/types.js";
import { HitlError } from "../../core/types.js";

/**
 * Slack adapter scaffold. MVP uses FakeChannelAdapter for core validation.
 * Real Socket Mode integration is the next milestone.
 *
 * All Slack-specific logic (Socket Mode, thread_ts, channel IDs) stays here.
 */
export class SlackAdapter implements ChannelAdapter {
  readonly type: ChannelType = "slack";

  private readonly handlers: MessageHandler[] = [];

  async authenticate(): Promise<void> {
    throw new HitlError(
      "PROVIDER_NOT_CONFIGURED",
      "Slack authentication is not implemented yet. Use the fake channel for MVP, or wait for the Slack Socket Mode milestone.",
    );
  }

  async isAuthenticated(): Promise<boolean> {
    return false;
  }

  async connect(): Promise<void> {
    throw new HitlError(
      "PROVIDER_NOT_CONFIGURED",
      "Slack Socket Mode connection is not implemented yet.",
    );
  }

  async disconnect(): Promise<void> {
    // no-op until Socket Mode is implemented
  }

  async listTargets(): Promise<Target[]> {
    return [];
  }

  async sendMessage(_targetId: string, _message: string): Promise<SentMessage> {
    throw new HitlError(
      "PROVIDER_NOT_CONFIGURED",
      "Slack sendMessage is not implemented yet.",
    );
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }
}
