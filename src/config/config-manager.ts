import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { constants } from "node:fs";
import {
  HitlConfigSchema,
  type HitlConfig,
} from "./config-schema.js";
import { DEFAULT_CONFIG, getConfigPath } from "./defaults.js";
import { HitlError } from "../core/types.js";

/**
 * Persistent user preferences only (default target, enabled providers).
 * Never stores pending requests, messages, or agent state.
 */
export class ConfigManager {
  constructor(private readonly configPath = getConfigPath()) {}

  getPath(): string {
    return this.configPath;
  }

  async exists(): Promise<boolean> {
    try {
      await access(this.configPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<HitlConfig> {
    if (!(await this.exists())) {
      return structuredClone(DEFAULT_CONFIG);
    }

    try {
      const raw = await readFile(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return HitlConfigSchema.parse(parsed);
    } catch (error) {
      throw new HitlError(
        "CONFIG_ERROR",
        `Failed to load config from ${this.configPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async save(config: HitlConfig): Promise<void> {
    const validated = HitlConfigSchema.parse(config);
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(
      this.configPath,
      `${JSON.stringify(validated, null, 2)}\n`,
      "utf8",
    );
  }

  /**
   * Update default target without touching credentials or other channels.
   * Used by setup — never by ask_human / notify_human overrides.
   */
  async setDefaultTarget(target: HitlConfig["defaultTarget"]): Promise<HitlConfig> {
    const config = await this.load();
    config.defaultTarget = target;
    await this.save(config);
    return config;
  }
}
