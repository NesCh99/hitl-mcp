import { join } from "node:path";
import type { HitlConfig } from "./config-schema.js";

export const DEFAULT_CONFIG: HitlConfig = {
  targets: [],
  channels: {
    fake: {
      enabled: true,
      targets: [
        { id: "local-hitl", label: "Local HITL" },
        { id: "development", label: "Development" },
      ],
    },
  },
};

export function getConfigDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return join(home, ".hitl-mcp");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function getCredentialsDir(): string {
  return join(getConfigDir(), "credentials");
}

/** Baileys multi-file auth state (separate from credentials JSON pointer). */
export function getWhatsAppAuthDir(): string {
  return join(getCredentialsDir(), "whatsapp-auth");
}

/** Project-local HITL config (agent-agnostic). */
export function getProjectConfigPath(projectRoot: string): string {
  return join(projectRoot, ".hitl-mcp", "config.json");
}

export function resolveProjectRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const root = env.HITL_PROJECT_ROOT?.trim();
  return root && root.length > 0 ? root : undefined;
}
