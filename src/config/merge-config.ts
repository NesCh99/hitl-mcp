import type {
  ChannelTypeConfig,
  ConfiguredTarget,
  HitlConfig,
  TargetConfig,
} from "./config-schema.js";

/** Channel key used by /hitl-channel.<channel> and defaultTarget. */
export function targetKey(target: ConfiguredTarget): ChannelTypeConfig {
  return target.channel;
}

export function listTargetChannels(config: HitlConfig): ChannelTypeConfig[] {
  return config.targets.map(targetKey).sort();
}

export function findTarget(
  config: HitlConfig,
  channel: string,
): ConfiguredTarget | undefined {
  return config.targets.find((t) => t.channel === channel);
}

export function toSendTarget(target: ConfiguredTarget): TargetConfig {
  return { channel: target.channel, id: target.id };
}

/**
 * Merge target lists by channel. Project entries replace global ones for the same channel.
 */
export function mergeTargets(
  globalTargets: ConfiguredTarget[],
  projectTargets: ConfiguredTarget[],
): ConfiguredTarget[] {
  const byChannel = new Map<string, ConfiguredTarget>();
  for (const target of globalTargets) {
    byChannel.set(target.channel, target);
  }
  for (const target of projectTargets) {
    byChannel.set(target.channel, target);
  }
  return [...byChannel.values()];
}

/**
 * Merge global and project HITL config.
 * Project wins on defaultTarget and same-channel targets; channel prefs shallow-merge.
 */
export function mergeConfigs(
  globalConfig: HitlConfig,
  projectConfig: HitlConfig | null | undefined,
): HitlConfig {
  if (!projectConfig) {
    return structuredClone(globalConfig);
  }

  return {
    defaultTarget: projectConfig.defaultTarget ?? globalConfig.defaultTarget,
    targets: mergeTargets(globalConfig.targets, projectConfig.targets),
    channels: {
      fake: {
        ...globalConfig.channels.fake,
        ...projectConfig.channels.fake,
      },
      slack: {
        ...globalConfig.channels.slack,
        ...projectConfig.channels.slack,
      },
      whatsapp: {
        ...globalConfig.channels.whatsapp,
        ...projectConfig.channels.whatsapp,
      },
    },
  };
}

export function resolveNamedTarget(
  config: HitlConfig,
  channel: string,
): TargetConfig | undefined {
  const found = findTarget(config, channel);
  return found ? toSendTarget(found) : undefined;
}

export function resolveDefaultTargetName(config: HitlConfig): string | undefined {
  return config.defaultTarget;
}
