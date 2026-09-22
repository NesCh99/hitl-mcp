import { HitlError, type ChannelType } from "../core/types.js";
import type { ChannelAdapter } from "./channel-adapter.js";

/**
 * Registers adapters and routes by ChannelType.
 * Does not own tasks, persistence, or pending-request state.
 */
export class ChannelManager {
  private readonly adapters = new Map<ChannelType, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  has(type: ChannelType): boolean {
    return this.adapters.has(type);
  }

  getAdapter(type: ChannelType): ChannelAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new HitlError(
        "PROVIDER_NOT_CONFIGURED",
        `No adapter registered for channel "${type}".`,
      );
    }
    return adapter;
  }

  listAdapters(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }

  listTypes(): ChannelType[] {
    return [...this.adapters.keys()];
  }
}
