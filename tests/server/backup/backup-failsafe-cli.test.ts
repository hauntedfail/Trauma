import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runBackupFailsafeCli } from "../../../scripts/trauma-backup-failsafe";
import { loadTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";

const tempDirs: string[] = [];
const now = new Date("2026-05-13T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("backup failsafe CLI", () => {
  it("prints a dry-run revert summary by default and requires --apply to edit config", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    await seedPathDriftAlert(configPath, root);

    const output = await runBackupFailsafeCli([
      "revert",
      "--config",
      configPath,
    ]);

    expect(output).toContain("DRY RUN");
    expect(output).toContain("Revert config");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      projectPath: "./new-data",
      storePath: "./new-data/storage",
    });
  });

  it("applies migration without overwriting conflicting target content", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const oldStore = join(root, "old-data/storage");
    const newStore = join(root, "new-data/storage");
    await mkdir(join(oldStore, "memories", "memory-1"), { recursive: true });
    await mkdir(join(newStore, "memories", "memory-1"), { recursive: true });
    await writeFile(join(oldStore, "memories/memory-1/CONTENT.md"), "# Old\n", "utf8");
    await writeFile(join(newStore, "memories/memory-1/CONTENT.md"), "# Existing\n", "utf8");
    await seedPathDriftAlert(configPath, root);

    await expect(
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    ).rejects.toThrow(/refusing to overwrite existing backup content/);
  });
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "trauma-backup-cli-"));
  tempDirs.push(root);
  return root;
}

async function writeConfig(root: string) {
  const configPath = join(root, "trauma.config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        projectPath: "./new-data",
        storePath: "./new-data/storage",
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
      },
      null,
      2,
    ),
    "utf8",
  );
  return configPath;
}

async function seedPathDriftAlert(configPath: string, root: string) {
  const config = loadTraumaConfig({ configPath });
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
      id: "default",
      projectPath: join(root, "old-data"),
      storePath: join(root, "old-data/storage"),
      gitRemote: "origin",
      gitRemoteUrl: null,
      gitBranch: "main",
      createdAt: now,
      updatedAt: now,
    });
    await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
      id: "active",
      kind: "backup_path_drift",
      severity: "critical",
      message: "Backup location changed",
      previousProjectPath: join(root, "old-data"),
      previousStorePath: join(root, "old-data/storage"),
      currentProjectPath: config.projectPath,
      currentStorePath: config.storePath,
      gitRemote: "origin",
      gitRemoteUrl: null,
      gitBranch: "main",
      error: null,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }
}
