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
  loadConfig: () => Promise<HitlConfig>;
}

/**
 * Wire persistent config/credentials separately from ephemeral HITL runtime.
 */
export async function createApp(options?: {
  configPath?: string;
  /** When true, skip registering unimplemented real providers (useful in tests). */
  fakeOnly?: boolean;
}): Promise<AppContext> {
  const configManager = new ConfigManager(options?.configPath);
  const credentialStore = new LocalCredentialStore();
  const channelManager = new ChannelManager();

  const config = await configManager.load();
  const fakeTargets =
    config.channels.fake?.targets ?? [
      { targetId: "local-hitl", label: "Local HITL" },
      { targetId: "development", label: "Development" },
    ];

  const fakeAdapter = new FakeChannelAdapter(fakeTargets);
  channelManager.register(fakeAdapter);

  if (!options?.fakeOnly) {
    channelManager.register(new SlackAdapter());
    channelManager.register(new WhatsAppAdapter());
  }

  // Restore fake auth from credential store if previously set up.
  const fakeCreds = await credentialStore.get("fake");
  if (fakeCreds) {
    await fakeAdapter.authenticate();
  }

  let cachedConfig = config;
  const hitl = new HitlManager(channelManager, () => cachedConfig);

  return {
    configManager,
    credentialStore,
    channelManager,
    hitl,
    fakeAdapter,
    loadConfig: async () => {
      cachedConfig = await configManager.load();
      return cachedConfig;
    },
  };
}
