import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadTraumaConfig } from "../../../src/server/config";

const gitConfig = {
  enabled: true,
  remote: "origin",
  branch: "main",
  push: false,
  commitMessageTemplate: "backup memory {memoryId}",
};

function createTempRoot() {
  return mkdtempSync(join(tmpdir(), "trauma-config-"));
}

function writeConfig(root: string, config: unknown) {
  mkdirSync(root, { recursive: true });
  const configPath = join(root, "trauma.config.json");
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  return configPath;
}

describe("loadTraumaConfig", () => {
  it("loads valid JSON config and resolves runtime paths", () => {
    const root = createTempRoot();
    const configPath = writeConfig(root, {
      storePath: "./data/store",
      projectPath: "./data",
      databasePath: "./.trauma/trauma.sqlite",
      backup: { git: gitConfig },
    });

    const config = loadTraumaConfig({ configPath });

    expect(config.configFilePath).toBe(configPath);
    expect(config.projectPath).toBe(join(root, "data"));
    expect(config.storePath).toBe(join(root, "data/store"));
    expect(config.databasePath).toBe(join(root, ".trauma/trauma.sqlite"));
    expect(config.backup.git).toEqual(gitConfig);
  });

  it("reports invalid JSON clearly", () => {
    const root = createTempRoot();
    const configPath = join(root, "trauma.config.json");
    writeFileSync(configPath, "{", "utf8");

    expect(() => loadTraumaConfig({ configPath })).toThrow(
      /Invalid JSON in trauma config/,
    );
  });

  it("rejects storePath outside projectPath", () => {
    const root = createTempRoot();
    const configPath = writeConfig(root, {
      storePath: "../outside-store",
      projectPath: "./data",
      databasePath: "./.trauma/trauma.sqlite",
      backup: { git: gitConfig },
    });

    expect(() => loadTraumaConfig({ configPath })).toThrow(
      /storePath must be inside projectPath/,
    );
  });

  it("rejects databasePath inside storePath", () => {
    const root = createTempRoot();
    const configPath = writeConfig(root, {
      storePath: "./data/store",
      projectPath: "./data",
      databasePath: "./data/store/.trauma/trauma.sqlite",
      backup: { git: gitConfig },
    });

    expect(() => loadTraumaConfig({ configPath })).toThrow(
      /databasePath must be outside storePath/,
    );
  });
});
