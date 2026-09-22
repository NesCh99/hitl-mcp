/**
 * Core types for HITL-MCP.
 *
 * Runtime state modeled here is ephemeral. Only Target and config-related
 * shapes may appear in persisted user configuration.
 */

export type ChannelType = "fake" | "slack" | "whatsapp";

/**
 * A communication destination. The meaning of `targetId` is adapter-owned.
 * Core never interprets provider-specific concepts (channels, chats, groups).
 */
export interface Target {
  channel: ChannelType;
  targetId: string;
}

export interface SentMessage {
  messageId: string;
  target: Target;
  text: string;
}

export interface IncomingMessage {
  channel: ChannelType;
  targetId: string;
  messageId: string;
  /** Native reply/thread relationship when the provider exposes one. */
  replyToMessageId?: string;
  senderId: string;
  text: string;
}

export interface PendingRequest {
  requestId: string;
  connectionId: string;
  target: Target;
  outboundMessageId: string;
  createdAt: number;
  expiresAt?: number;
  resolve: (response: IncomingMessage) => void;
  reject: (error: Error) => void;
}

export class HitlError extends Error {
  readonly code: HitlErrorCode;

  constructor(code: HitlErrorCode, message: string) {
    super(message);
    this.name = "HitlError";
    this.code = code;
  }
}

export type HitlErrorCode =
  | "NO_DEFAULT_TARGET"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_NOT_AUTHENTICATED"
  | "TARGET_NOT_FOUND"
  | "CONNECTION_FAILURE"
  | "TIMEOUT"
  | "CONNECTION_CLOSED"
  | "INVALID_TARGET"
  | "CORRELATION_FAILURE"
  | "CONFIG_ERROR";
