import { execFileSync } from "node:child_process";
import {
  accessSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadRuntimeTraumaConfig, loadTraumaConfig } from "../../../src/server/config";

const gitConfig = {
  enabled: true,
  remote: "origin",
  branch: "main",
  push: false,
  commitMessageTemplate: "backup {action} {memoryId}",
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

  it("resolves a relative configPath from cwd when both are provided", () => {
    const root = createTempRoot();
    writeConfig(root, {
      storePath: "./data/store",
      projectPath: "./data",
      databasePath: "./.trauma/trauma.sqlite",
      backup: { git: gitConfig },
    });

    const config = loadTraumaConfig({
      cwd: root,
      configPath: "trauma.config.json",
    });

    expect(config.configFilePath).toBe(join(root, "trauma.config.json"));
    expect(config.storePath).toBe(join(root, "data/store"));
  });

  it("loads the runtime config path from TRAUMA_CONFIG_PATH", () => {
    const root = createTempRoot();
    const configPath = writeConfig(root, {
      storePath: "./data/store",
      projectPath: "./data",
      databasePath: "./.trauma/trauma.sqlite",
      backup: { git: gitConfig },
    });
    const previousConfigPath = process.env.TRAUMA_CONFIG_PATH;
    process.env.TRAUMA_CONFIG_PATH = configPath;

    try {
      const config = loadRuntimeTraumaConfig();
      expect(config.configFilePath).toBe(configPath);
      expect(config.storePath).toBe(join(root, "data/store"));
    } finally {
      restoreEnv("TRAUMA_CONFIG_PATH", previousConfigPath);
    }
  });

  it("resolves drizzle-kit database path from TRAUMA_CONFIG_PATH unless TRAUMA_DATABASE_PATH overrides it", () => {
    const root = createTempRoot();
    const configPath = writeConfig(root, {
      storePath: "./data/store",
      projectPath: "./data",
      databasePath: "./custom/trauma.sqlite",
      backup: { git: gitConfig },
    });
    const overridePath = join(root, "override.sqlite");

    const fromConfig = readDrizzleDatabasePath({
      TRAUMA_CONFIG_PATH: configPath,
      TRAUMA_DATABASE_PATH: undefined,
    });
    const fromOverride = readDrizzleDatabasePath({
      TRAUMA_CONFIG_PATH: configPath,
      TRAUMA_DATABASE_PATH: overridePath,
    });

    expect(fromConfig).toBe(join(root, "custom/trauma.sqlite"));
    expect(fromOverride).toBe(overridePath);
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

  it("rejects a storePath symlink whose target is outside projectPath", () => {
    const root = createTempRoot();
    const projectPath = join(root, "data");
    const outsideStorePath = join(root, "outside-store");
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(outsideStorePath, { recursive: true });
    symlinkSync(outsideStorePath, join(projectPath, "store"), "dir");
    const configPath = writeConfig(root, {
      storePath: "./data/store",
      projectPath: "./data",
      databasePath: "./.trauma/trauma.sqlite",
      backup: { git: gitConfig },
    });

    expect(() => loadTraumaConfig({ configPath })).toThrow(
      /storePath must be inside projectPath/,
    );
  });

  it("rejects a nested storePath symlink that escapes a symlinked projectPath", () => {
    const root = createTempRoot();
    const effectiveProjectPath = join(root, "effective-project");
    const outsideStorePath = join(root, "outside-store");
    mkdirSync(effectiveProjectPath, { recursive: true });
    mkdirSync(outsideStorePath, { recursive: true });
    symlinkSync(effectiveProjectPath, join(root, "project"), "dir");
    symlinkSync(outsideStorePath, join(effectiveProjectPath, "store"), "dir");
    const configPath = writeConfig(root, {
      storePath: "./project/store",
      projectPath: "./project",
      databasePath: "./.trauma/trauma.sqlite",
      backup: { git: gitConfig },
    });

    expect(() => loadTraumaConfig({ configPath })).toThrow(
      /storePath must be inside projectPath/,
    );
  });

  it("allows a missing storePath below a symlinked projectPath", () => {
    const root = createTempRoot();
    const effectiveProjectPath = join(root, "effective-project");
    mkdirSync(effectiveProjectPath, { recursive: true });
    symlinkSync(effectiveProjectPath, join(root, "project"), "dir");
    const configPath = writeConfig(root, {
      storePath: "./project/store/not-created-yet",
      projectPath: "./project",
      databasePath: "./.trauma/trauma.sqlite",
      backup: { git: gitConfig },
    });

    const config = loadTraumaConfig({ configPath });

    expect(config.projectPath).toBe(join(root, "project"));
    expect(config.storePath).toBe(join(root, "project/store/not-created-yet"));
  });

  it("still rejects lexically separate aliases of the same project tree", () => {
    const root = createTempRoot();
    const effectiveProjectPath = join(root, "effective-project");
    mkdirSync(join(effectiveProjectPath, "store"), { recursive: true });
    symlinkSync(effectiveProjectPath, join(root, "project"), "dir");
    const configPath = writeConfig(root, {
      storePath: "./effective-project/store",
      projectPath: "./project",
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

  it("rejects a databasePath symlink whose target is inside storePath", () => {
    const root = createTempRoot();
    const storePath = join(root, "data/store");
    const databasePath = join(storePath, "trauma.sqlite");
    mkdirSync(storePath, { recursive: true });
    writeFileSync(databasePath, "", "utf8");
    mkdirSync(join(root, ".trauma"), { recursive: true });
    symlinkSync(databasePath, join(root, ".trauma/trauma.sqlite"), "file");
    const configPath = writeConfig(root, {
      storePath: "./data/store",
      projectPath: "./data",
      databasePath: "./.trauma/trauma.sqlite",
      backup: { git: gitConfig },
    });

    expect(() => loadTraumaConfig({ configPath })).toThrow(
      /databasePath must be outside storePath/,
    );
  });

  it("rejects literal tilde paths instead of treating them as config-relative directories", () => {
    const root = createTempRoot();
    const configPath = writeConfig(root, {
      storePath: "~/trauma/storage",
      projectPath: "~/trauma",
      databasePath: "./.trauma/trauma.sqlite",
      backup: { git: gitConfig },
    });

    expect(() => loadTraumaConfig({ configPath })).toThrow(
      /projectPath must not start with ~/,
    );
    expect(() => loadTraumaConfig({ configPath })).toThrow(
      /storePath must not start with ~/,
    );
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function readDrizzleDatabasePath(env: {
  TRAUMA_CONFIG_PATH: string;
  TRAUMA_DATABASE_PATH: string | undefined;
}) {
  const script = `
    const config = await import("./drizzle.config.ts");
    process.stdout.write(config.default.dbCredentials.url);
  `;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    TRAUMA_CONFIG_PATH: env.TRAUMA_CONFIG_PATH,
  };
  if (env.TRAUMA_DATABASE_PATH === undefined) {
    delete childEnv.TRAUMA_DATABASE_PATH;
  } else {
    childEnv.TRAUMA_DATABASE_PATH = env.TRAUMA_DATABASE_PATH;
  }

  return execFileSync(resolveBunExecutable(), ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: childEnv,
  });
}

function resolveBunExecutable(): string {
  if (process.versions.bun !== undefined) {
    return process.execPath;
  }

  const candidates = [
    process.env.BUN_EXECUTABLE,
    ...findMiseBunExecutables(),
    "bun",
  ];
  const executable = candidates.find(
    (candidate) =>
      candidate !== undefined &&
      (candidate.includes("/") ? canAccess(candidate) : true),
  );
  if (executable === undefined) {
    throw new Error("Bun executable is required for drizzle config tests");
  }

  return executable;
}

function findMiseBunExecutables(): string[] {
  const installsRoot =
    process.env.MISE_INSTALL_PATH ?? join(homedir(), ".local/share/mise/installs");
  const bunInstallsRoot = join(installsRoot, "bun");

  try {
    return readdirSync(bunInstallsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(bunInstallsRoot, entry.name, "bin/bun"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function canAccess(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}
