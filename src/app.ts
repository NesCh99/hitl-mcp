import { LocalCredentialStore } from "./auth/credential-store.js";
import { ChannelManager } from "./channels/channel-manager.js";
import { FakeChannelAdapter } from "./channels/fake/fake-channel-adapter.js";
import { SlackAdapter } from "./channels/slack/slack-adapter.js";
import { WhatsAppAdapter } from "./channels/whatsapp/whatsapp-adapter.js";
import { ConfigManager } from "./config/config-manager.js";
import { HitlManager } from "./core/hitl-manager.js";
import type { HitlConfig } from "./config/config-schema.js";

export interface AppContext {
  configManager: ConfigManager;
  credentialStore: LocalCredentialStore;
  channelManager: ChannelManager;
  hitl: HitlManager;
  fakeAdapter: FakeChannelAdapter;
  slackAdapter: SlackAdapter;
  whatsappAdapter: WhatsAppAdapter;
  loadConfig: () => Promise<HitlConfig>;
}

/**
 * Wire persistent config/credentials separately from ephemeral HITL runtime.
 */
export async function createApp(options?: {
  configPath?: string;
  projectRoot?: string | null;
  /** When true, register only Fake (useful for isolated core tests). */
  fakeOnly?: boolean;
}): Promise<AppContext> {
  const configManager = new ConfigManager({
    globalPath: options?.configPath,
    ...(options && "projectRoot" in options
      ? { projectRoot: options.projectRoot }
      : {}),
  });
  const credentialStore = new LocalCredentialStore();
  const channelManager = new ChannelManager();

  const config = await configManager.load();
  const fakeTargets =
    config.channels.fake?.targets ?? [
      { id: "local-hitl", label: "Local HITL" },
      { id: "development", label: "Development" },
    ];

  const fakeAdapter = new FakeChannelAdapter(fakeTargets);
  channelManager.register(fakeAdapter);

  const slackAdapter = new SlackAdapter({ credentialStore });
  const whatsappAdapter = new WhatsAppAdapter({ credentialStore });
  if (!options?.fakeOnly) {
    channelManager.register(slackAdapter);
    channelManager.register(whatsappAdapter);
  }

  // Restore fake auth from credential store if previously set up.
  const fakeCreds = await credentialStore.get("fake");
  if (fakeCreds) {
    await fakeAdapter.authenticate();
  }

  // Validate Slack credentials when present.
  if (!options?.fakeOnly && (await slackAdapter.isAuthenticated())) {
    try {
      await slackAdapter.authenticate();
    } catch {
      // Leave unauthenticated; ask_human will surface a clear error.
    }
  }

  // Validate WhatsApp session pointer when present.
  if (!options?.fakeOnly && (await whatsappAdapter.isAuthenticated())) {
    try {
      await whatsappAdapter.authenticate();
    } catch {
      // Leave unauthenticated; ask_human will surface a clear error.
    }
  }

  let cachedConfig = config;
  const hitl = new HitlManager(channelManager, () => cachedConfig);

  return {
    configManager,
    credentialStore,
    channelManager,
    hitl,
    fakeAdapter,
    slackAdapter,
    whatsappAdapter,
    loadConfig: async () => {
      cachedConfig = await configManager.load();
      return cachedConfig;
    },
  };
}
