import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigManager } from "../src/config/config-manager.js";
import { mergeConfigs } from "../src/config/merge-config.js";
import type { HitlConfig } from "../src/config/config-schema.js";

describe("mergeConfigs", () => {
  it("returns a clone of global when project is absent", () => {
    const global: HitlConfig = {
      defaultTarget: "whatsapp",
      targets: [{ channel: "whatsapp", id: "1@g.us" }],
      channels: { whatsapp: { enabled: true } },
    };
    const merged = mergeConfigs(global, null);
    expect(merged).toEqual(global);
    expect(merged).not.toBe(global);
  });

  it("lets project override defaultTarget and same-channel targets", () => {
    const global: HitlConfig = {
      defaultTarget: "whatsapp",
      targets: [
        { channel: "whatsapp", id: "global@g.us" },
        { channel: "slack", id: "C_GLOBAL" },
      ],
      channels: {
        whatsapp: { enabled: true },
        slack: { enabled: true },
      },
    };
    const project: HitlConfig = {
      defaultTarget: "slack",
      targets: [{ channel: "slack", id: "C_PROJECT" }],
      channels: {},
    };

    const merged = mergeConfigs(global, project);
    expect(merged.defaultTarget).toBe("slack");
    expect(merged.targets.find((t) => t.channel === "slack")?.id).toBe("C_PROJECT");
    expect(merged.targets.find((t) => t.channel === "whatsapp")?.id).toBe("global@g.us");
  });
});

describe("ConfigManager project merge", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("merges project .hitl-mcp/config.json over global", async () => {
    tmp = await mkdtemp(join(tmpdir(), "hitl-cfg-"));
    const globalPath = join(tmp, "global-config.json");
    const projectRoot = join(tmp, "project");
    await mkdir(join(projectRoot, ".hitl-mcp"), { recursive: true });

    const global: HitlConfig = {
      defaultTarget: "whatsapp",
      targets: [
        { channel: "whatsapp", id: "g@g.us" },
        { channel: "slack", id: "C_G" },
      ],
      channels: {
        whatsapp: { enabled: true },
        slack: { enabled: true },
      },
    };
    await writeFile(globalPath, `${JSON.stringify(global, null, 2)}\n`);

    const project: HitlConfig = {
      defaultTarget: "slack",
      targets: [{ channel: "slack", id: "C_P" }],
      channels: {},
    };
    await writeFile(
      join(projectRoot, ".hitl-mcp", "config.json"),
      `${JSON.stringify(project, null, 2)}\n`,
    );

    const manager = new ConfigManager({ globalPath, projectRoot });
    const loaded = await manager.load();
    expect(loaded.defaultTarget).toBe("slack");
    expect(loaded.targets.find((t) => t.channel === "slack")?.id).toBe("C_P");
    expect(loaded.targets.find((t) => t.channel === "whatsapp")?.id).toBe("g@g.us");
  });

  it("upsertTarget writes channel default into global", async () => {
    tmp = await mkdtemp(join(tmpdir(), "hitl-cfg-"));
    const globalPath = join(tmp, "global-config.json");
    const manager = new ConfigManager({ globalPath });

    await manager.upsertTarget({
      channel: "slack",
      id: "C_OPS",
      label: "#ops",
    });

    const global = await manager.loadGlobal();
    expect(global.defaultTarget).toBe("slack");
    expect(global.targets).toEqual([
      { channel: "slack", id: "C_OPS", label: "#ops" },
    ]);
  });
});
