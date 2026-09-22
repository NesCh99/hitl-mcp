import type {
  ChannelType,
  IncomingMessage,
  SentMessage,
  Target,
} from "../core/types.js";

export type MessageHandler = (message: IncomingMessage) => void;

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

  listTargets(): Promise<Target[]>;

  sendMessage(targetId: string, message: string): Promise<SentMessage>;

  onMessage(handler: MessageHandler): void;
}
