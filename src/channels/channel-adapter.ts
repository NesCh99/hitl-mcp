import type {
  ChannelType,
  IncomingMessage,
  SendMessageOptions,
  SentMessage,
  Target,
} from "../core/types.js";

export type MessageHandler = (message: IncomingMessage) => void;

/**
 * Target plus an optional display label for setup UIs.
 * Core routing still uses only `channel` + `targetId`.
 */
export interface ListedTarget extends Target {
  label?: string;
}

/**
 * Provider-specific communication. Core must never contain Slack/WhatsApp logic.
 * Authentication, connection, IDs, reply relationships, and event formats live here.
 */
export interface ChannelAdapter {
  readonly type: ChannelType;

  authenticate(): Promise<void>;

  isAuthenticated(): Promise<boolean>;

  connect(): Promise<void>;

  disconnect(): Promise<void>;

  listTargets(): Promise<ListedTarget[]>;

  sendMessage(
    targetId: string,
    message: string,
    options?: SendMessageOptions,
  ): Promise<SentMessage>;

  onMessage(handler: MessageHandler): void;
}
