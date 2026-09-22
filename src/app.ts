import { LocalCredentialStore } from "./auth/credential-store.js";
import { ChannelManager } from "./channels/channel-manager.js";
import { FakeChannelAdapter } from "./channels/fake/fake-channel-adapter.js";
import { SlackAdapter } from "./channels/slack/slack-adapter.js";
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
  loadConfig: () => Promise<HitlConfig>;
}

/**
 * Wire persistent config/credentials separately from ephemeral HITL runtime.
 */
export async function createApp(options?: {
  configPath?: string;
  /** When true, register only Fake (useful for isolated core tests). */
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

  const slackAdapter = new SlackAdapter({ credentialStore });
  if (!options?.fakeOnly) {
    channelManager.register(slackAdapter);
  }

  // Restore fake auth from credential store if previously set up.
  const fakeCreds = await credentialStore.get("fake");
  if (fakeCreds) {
    await fakeAdapter.authenticate();
  }

  // Validate Slack credentials when present (does not start Socket Mode yet).
  if (!options?.fakeOnly && (await slackAdapter.isAuthenticated())) {
    try {
      await slackAdapter.authenticate();
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
    loadConfig: async () => {
      cachedConfig = await configManager.load();
      return cachedConfig;
    },
  };
}
