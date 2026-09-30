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
 */
export interface ListedTarget extends Target {
  label?: string;
}

/**
 * Provider-specific communication: auth, connection, IDs, replies, and events.
 */
export interface ChannelAdapter {
  readonly type: ChannelType;

  authenticate(): Promise<void>;

  isAuthenticated(): Promise<boolean>;

  connect(): Promise<void>;

  disconnect(): Promise<void>;

  listTargets(): Promise<ListedTarget[]>;

  sendMessage(
    id: string,
    message: string,
    options?: SendMessageOptions,
  ): Promise<SentMessage>;

  /** One-off send used by setup greeting. */
  sendPlainMessage(id: string, message: string): Promise<SentMessage>;

  onMessage(handler: MessageHandler): void;
}
