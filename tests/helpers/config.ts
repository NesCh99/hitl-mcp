/** Shared test config helpers — one destination per channel. */
import type { ConfiguredTarget, HitlConfig } from "../src/config/config-schema.js";

export function fakeHitlConfig(options?: {
  defaultTarget?: HitlConfig["defaultTarget"];
  targets?: ConfiguredTarget[];
  channels?: HitlConfig["channels"];
}): HitlConfig {
  return {
    defaultTarget: options?.defaultTarget ?? "fake",
    targets: options?.targets ?? [
      { channel: "fake", id: "local-hitl", label: "Local HITL" },
    ],
    channels: {
      fake: {
        enabled: true,
        targets: [
          { id: "local-hitl", label: "Local HITL" },
          { id: "development", label: "Development" },
        ],
      },
      ...options?.channels,
    },
  };
}
