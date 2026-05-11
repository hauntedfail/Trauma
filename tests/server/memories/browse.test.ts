import { execFileSync } from "node:child_process";
import { accessSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadBrowseMemories } from "../../../src/server/memories/browse";

const previousConfigPath = process.env.TRAUMA_CONFIG_PATH;

afterEach(() => {
  restoreEnv("TRAUMA_CONFIG_PATH", previousConfigPath);
});

describe("browse memory loader error policy", () => {
  it("surfaces missing required config instead of rendering an empty archive", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "trauma-missing-config-"));

    await withCwd(cwd, async () => {
      await expect(loadBrowseMemories()).rejects.toThrow(/Missing trauma config/);
    });
  });

  it("loads browse memories using TRAUMA_CONFIG_PATH outside the current working directory", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "trauma-browse-cwd-"));
    const configRoot = mkdtempSync(join(tmpdir(), "trauma-browse-config-"));
    const configPath = writeConfig(configRoot);

    const output = runBunScript(
      `
        import { loadBrowseMemories } from "./src/server/memories/browse.ts";

        process.chdir(process.env.TRAUMA_TEST_CWD);
        process.env.TRAUMA_CONFIG_PATH = process.env.TRAUMA_TEST_CONFIG_PATH;

        const result = await loadBrowseMemories();
        process.stdout.write(JSON.stringify(result));
      `,
      {
        TRAUMA_TEST_CONFIG_PATH: configPath,
        TRAUMA_TEST_CWD: cwd,
      },
    );

    expect(JSON.parse(output)).toEqual([]);
  });

  it("starts the backup retry queue while loading browse memories", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "trauma-browse-retry-cwd-"));
    const configRoot = mkdtempSync(join(tmpdir(), "trauma-browse-retry-config-"));
    const configPath = writeConfig(configRoot);

    const output = runBunScript(
      `
        import { loadBrowseMemories } from "./src/server/memories/browse.ts";

        process.chdir(process.env.TRAUMA_TEST_CWD);
        process.env.TRAUMA_CONFIG_PATH = process.env.TRAUMA_TEST_CONFIG_PATH;

        const starts = [];
        await loadBrowseMemories({
          startBackupQueue: (config) => {
            starts.push(config.projectPath);
          },
        });
        process.stdout.write(JSON.stringify(starts));
      `,
      {
        TRAUMA_TEST_CONFIG_PATH: configPath,
        TRAUMA_TEST_CWD: cwd,
      },
    );

    expect(JSON.parse(output)).toEqual([join(configRoot, "data")]);
  });
});

async function withCwd<T>(cwd: string, callback: () => Promise<T>): Promise<T> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await callback();
  } finally {
    process.chdir(previousCwd);
  }
}

function writeConfig(root: string): string {
  mkdirSync(root, { recursive: true });
  const configPath = join(root, "trauma.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      storePath: "./data/store",
      projectPath: "./data",
      databasePath: "./.trauma/trauma.sqlite",
      backup: {
        git: {
          enabled: true,
          remote: "origin",
          branch: "main",
          push: false,
          commitMessageTemplate: "backup memory {memoryId}",
        },
      },
    }),
    "utf8",
  );
  return configPath;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function runBunScript(script: string, env: Record<string, string>): string {
  const repositoryRoot = process.cwd();
  const cacheDir = join(repositoryRoot, ".tmp/bun-cache");
  const temporaryDir = join(repositoryRoot, ".tmp/bun-tmp");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(temporaryDir, { recursive: true });

  return execFileSync(resolveBunExecutable(), ["-e", script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      BUN_INSTALL_CACHE_DIR: cacheDir,
      TMPDIR: temporaryDir,
    },
  });
}

function resolveBunExecutable(): string {
  if (process.versions.bun !== undefined) {
    return process.execPath;
  }

  const candidates = [
    process.env.BUN_EXECUTABLE,
    join(homedir(), ".local/share/mise/installs/bun/1.3.13/bin/bun"),
    process.env.npm_execpath,
    "bun",
  ];
  const executable = candidates.find(
    (candidate) =>
      candidate !== undefined &&
      isBunExecutable(candidate) &&
      (candidate.includes("/") ? canAccess(candidate) : true),
  );
  if (executable === undefined) {
    throw new Error("Bun executable is required for browse memory tests");
  }

  return executable;
}

function isBunExecutable(path: string): boolean {
  return path === "bun" || path.endsWith("/bun") || path.endsWith("\\bun.exe");
}

function canAccess(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}
