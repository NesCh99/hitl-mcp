/**
 * Ephemeral per-agent-chat preferences.
 * Keyed by session id; gone when the MCP process exits.
 */

import type { ChannelTypeConfig } from "../config/config-schema.js";

export interface SessionPrefs {
  /** When false, ask/notify soft-skip. Default true. */
  enabled: boolean;
  /** Selected provider channel; omit to use config.defaultTarget. */
  channel?: ChannelTypeConfig;
}

export interface SessionPrefsPatch {
  enabled?: boolean;
  /**
   * Set the provider channel for this chat (`slack` / `whatsapp` / `fake`).
   * Pass `null` to clear and fall back to config.defaultTarget.
   */
  channel?: ChannelTypeConfig | null;
}

export class SessionPrefsStore {
  private readonly prefs = new Map<string, SessionPrefs>();

  get(sessionId: string): SessionPrefs {
    return this.prefs.get(sessionId) ?? { enabled: true };
  }

  configure(sessionId: string, patch: SessionPrefsPatch): SessionPrefs {
    const current = this.get(sessionId);
    const next: SessionPrefs = {
      enabled: patch.enabled ?? current.enabled,
    };

    if (patch.channel === null) {
      // cleared
    } else if (patch.channel !== undefined) {
      next.channel = patch.channel;
    } else if (current.channel !== undefined) {
      next.channel = current.channel;
    }

    this.prefs.set(sessionId, next);
    return next;
  }

  clear(sessionId: string): void {
    this.prefs.delete(sessionId);
  }

  clearAll(): void {
    this.prefs.clear();
  }
}
