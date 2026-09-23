import { randomUUID } from "node:crypto";
import { correlateByReply } from "./correlation.js";
import {
  HitlError,
  type IncomingMessage,
  type PendingRequest,
  type Target,
} from "./types.js";

export interface CreatePendingRequestInput {
  connectionId: string;
  target: Target;
  outboundMessageId: string;
  sessionId?: string;
  question?: string;
  timeoutMs?: number;
}

/**
 * In-memory only. When the MCP process exits, all pending requests disappear.
 * That is intentional — HITL does not remember interactions across runs.
 */
export class PendingRequestManager {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  create(input: CreatePendingRequestInput): {
    requestId: string;
    promise: Promise<IncomingMessage>;
  } {
    const requestId = randomUUID();
    const createdAt = Date.now();
    const expiresAt =
      input.timeoutMs !== undefined ? createdAt + input.timeoutMs : undefined;

    let resolve!: (response: IncomingMessage) => void;
    let reject!: (error: Error) => void;

    const promise = new Promise<IncomingMessage>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    // Avoid unhandled rejection when clear/reject runs without an active awaiter.
    promise.catch(() => undefined);

    const request: PendingRequest = {
      requestId,
      connectionId: input.connectionId,
      target: input.target,
      outboundMessageId: input.outboundMessageId,
      sessionId: input.sessionId,
      question: input.question,
      createdAt,
      expiresAt,
      resolve,
      reject,
    };

    this.pending.set(requestId, request);

    if (input.timeoutMs !== undefined && input.timeoutMs > 0) {
      const timer = setTimeout(() => {
        this.reject(
          requestId,
          new HitlError(
            "TIMEOUT",
            `Timed out waiting for human response after ${input.timeoutMs}ms`,
          ),
        );
      }, input.timeoutMs);
      timer.unref?.();
      this.timers.set(requestId, timer);
    }

    return { requestId, promise };
  }

  resolve(requestId: string, response: IncomingMessage): boolean {
    const request = this.pending.get(requestId);
    if (!request) {
      return false;
    }
    this.clearTimer(requestId);
    this.pending.delete(requestId);
    request.resolve(response);
    return true;
  }

  reject(requestId: string, error: Error): boolean {
    const request = this.pending.get(requestId);
    if (!request) {
      return false;
    }
    this.clearTimer(requestId);
    this.pending.delete(requestId);
    request.reject(error);
    return true;
  }

  handleIncoming(message: IncomingMessage): boolean {
    const match = correlateByReply(this.pending, message);
    if (!match) {
      return false;
    }
    return this.resolve(match.requestId, message);
  }

  rejectConnection(
    connectionId: string,
    error: Error = new HitlError(
      "CONNECTION_CLOSED",
      "MCP connection closed while waiting for human response",
    ),
  ): number {
    let count = 0;
    for (const request of [...this.pending.values()]) {
      if (request.connectionId === connectionId) {
        this.reject(request.requestId, error);
        count += 1;
      }
    }
    return count;
  }

  get(requestId: string): PendingRequest | undefined {
    return this.pending.get(requestId);
  }

  size(): number {
    return this.pending.size;
  }

  clear(): void {
    for (const requestId of [...this.pending.keys()]) {
      this.reject(
        requestId,
        new HitlError("CONNECTION_CLOSED", "Pending request manager cleared"),
      );
    }
  }

  private clearTimer(requestId: string): void {
    const timer = this.timers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(requestId);
    }
  }
}
