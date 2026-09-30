import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { constants } from "node:fs";
import {
  HitlConfigSchema,
  type ConfiguredTarget,
  type HitlConfig,
} from "./config-schema.js";
import {
  DEFAULT_CONFIG,
  getConfigPath,
  getProjectConfigPath,
  resolveProjectRoot,
} from "./defaults.js";
import { mergeConfigs, targetKey } from "./merge-config.js";
import { HitlError } from "../core/types.js";

export interface ConfigManagerOptions {
  /** Global config file path. Defaults to ~/.hitl-mcp/config.json */
  globalPath?: string;
  /**
   * Project root that may contain `.hitl-mcp/config.json`.
   * Defaults to `HITL_PROJECT_ROOT` when set.
   * Pass `null` to disable project merge even if the env var is set.
   */
  projectRoot?: string | null;
}

/**
 * Persistent user preferences (named targets, default, enabled providers).
 * Never stores pending requests, messages, or agent state.
 *
 * Load returns **merged** global + project config.
 * Save writes the **global** file (setup owns global; project files are edited by hand).
 */
export class ConfigManager {
  private readonly globalPath: string;
  private readonly projectRoot: string | undefined;

  constructor(options: ConfigManagerOptions | string = {}) {
    // Allow single-string path for tests: `new ConfigManager(path)`.
    if (typeof options === "string") {
      this.globalPath = options;
      this.projectRoot = undefined;
      return;
    }
    this.globalPath = options.globalPath ?? getConfigPath();
    // undefined → read HITL_PROJECT_ROOT; null → force no project merge
    this.projectRoot =
      options.projectRoot === null
        ? undefined
        : (options.projectRoot ?? resolveProjectRoot());
  }

  getPath(): string {
    return this.globalPath;
  }

  getGlobalPath(): string {
    return this.globalPath;
  }

  getProjectPath(): string | undefined {
    return this.projectRoot
      ? getProjectConfigPath(this.projectRoot)
      : undefined;
  }

  getProjectRoot(): string | undefined {
    return this.projectRoot;
  }

  async exists(): Promise<boolean> {
    return pathExists(this.globalPath);
  }

  /** Merged global + project config. */
  async load(): Promise<HitlConfig> {
    const globalConfig = await this.loadFile(this.globalPath);
    const projectPath = this.getProjectPath();
    if (!projectPath || !(await pathExists(projectPath))) {
      return globalConfig;
    }
    const projectConfig = await this.loadFile(projectPath);
    return mergeConfigs(globalConfig, projectConfig);
  }

  /** Global file only (no project merge). */
  async loadGlobal(): Promise<HitlConfig> {
    return this.loadFile(this.globalPath);
  }

  /** Project file only, or null if missing / no project root. */
  async loadProject(): Promise<HitlConfig | null> {
    const projectPath = this.getProjectPath();
    if (!projectPath || !(await pathExists(projectPath))) {
      return null;
    }
    return this.loadFile(projectPath);
  }

  /** Persist global config (setup). Does not write the project file. */
  async save(config: HitlConfig): Promise<void> {
    await this.saveTo(this.globalPath, config);
  }

  async saveGlobal(config: HitlConfig): Promise<void> {
    await this.saveTo(this.globalPath, config);
  }

  /**
   * Upsert a configured target and optionally make it the default.
   * Writes the global config file.
   */
  async upsertTarget(
    entry: ConfiguredTarget,
    options?: { makeDefault?: boolean },
  ): Promise<HitlConfig> {
    const config = await this.loadGlobal();
    const key = targetKey(entry);
    const nextTargets = config.targets.filter((t) => targetKey(t) !== key);
    nextTargets.push(entry);
    config.targets = nextTargets;
    if (options?.makeDefault !== false) {
      config.defaultTarget = key;
    }
    await this.saveGlobal(config);
    return this.load();
  }

  private async loadFile(path: string): Promise<HitlConfig> {
    if (!(await pathExists(path))) {
      return structuredClone(DEFAULT_CONFIG);
    }

    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return HitlConfigSchema.parse(parsed);
    } catch (error) {
      throw new HitlError(
        "CONFIG_ERROR",
        `Failed to load config from ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async saveTo(path: string, config: HitlConfig): Promise<void> {
    const validated = HitlConfigSchema.parse(config);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
