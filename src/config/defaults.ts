import type { HitlConfig } from "./config-schema.js";

export const DEFAULT_CONFIG: HitlConfig = {
  channels: {
    fake: {
      enabled: true,
      targets: [
        { targetId: "local-hitl", label: "Local HITL" },
        { targetId: "development", label: "Development" },
      ],
    },
  },
};

export function getConfigDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return `${home}/.hitl-mcp`;
}

export function getConfigPath(): string {
  return `${getConfigDir()}/config.json`;
}

export function getCredentialsDir(): string {
  return `${getConfigDir()}/credentials`;
}

/** Baileys multi-file auth state (separate from credentials JSON pointer). */
export function getWhatsAppAuthDir(): string {
  return `${getCredentialsDir()}/whatsapp-auth`;
}
