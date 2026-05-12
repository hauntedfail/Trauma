import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BackupEnvironmentFailsafeError,
  assertBackupEnvironmentReady,
  ensureBackupEnvironment,
  getBackupFailsafeStatus,
} from "../../../src/server/backup/environment";
import { initializeDatabase } from "../../../src/server/db";
import type { ResolvedTraumaConfig } from "../../../src/server/config";

const tempDirs: string[] = [];
const now = new Date("2026-05-13T00:00:00.000Z");

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("backup environment failsafe", () => {
  it("persists the clean first-start backup environment stamp without disturbing memories", async () => {
    const root = await makeRoot();
    const config = createConfig(root);
    const connection = initializeDatabase(config);
    try {
      const result = await ensureBackupEnvironment({
        config,
        db: connection.db,
        now: () => now,
      });
      await connection.repositories.memories.create(createMemoryRow());

      expect(result.ok).toBe(true);
      expect(existsSync(join(config.projectPath, ".git"))).toBe(true);
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toBeUndefined();
      expect(await connection.repositories.memories.findById("memory-1"))
        .toMatchObject({ id: "memory-1", title: "Existing memory" });
      expect(await connection.repositories.backupEnvironment.getBackupEnvironmentStamp())
        .toMatchObject({
          id: "default",
          projectPath: config.projectPath,
          storePath: config.storePath,
          gitRemote: "origin",
          gitBranch: "main",
        });
    } finally {
      connection.close();
    }
  });

  it("creates a critical alert when existing content has no trusted stamp", async () => {
    const root = await makeRoot();
    const config = createConfig(root);
    await writeContent(config.storePath, "memory-without-stamp");
    const connection = initializeDatabase(config);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await ensureBackupEnvironment({
        config,
        db: connection.db,
        now: () => now,
      });

      expect(result.ok).toBe(false);
      expect(result.alert).toMatchObject({
        id: "active",
        kind: "backup_path_drift",
        severity: "critical",
        currentProjectPath: config.projectPath,
        currentStorePath: config.storePath,
      });
      expect(warn.mock.calls.join("\n")).toContain("Backup location changed");
      expect(warn.mock.calls.join("\n")).toContain("trauma-backup-failsafe.ts revert");
      expect(existsSync(join(config.projectPath, ".git"))).toBe(false);
    } finally {
      connection.close();
    }
  });

  it("creates a critical alert when stamped paths drift while data exists", async () => {
    const root = await makeRoot();
    const oldConfig = createConfig(root, "old-data", "old-storage");
    const newConfig = createConfig(root, "new-data", "new-storage");
    await writeContent(oldConfig.storePath, "memory-at-old-path");
    initializeGitRepository(oldConfig.projectPath);
    const connection = initializeDatabase(newConfig);
    try {
      await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
        id: "default",
        projectPath: oldConfig.projectPath,
        storePath: oldConfig.storePath,
        gitRemote: "origin",
        gitRemoteUrl: null,
        gitBranch: "main",
        createdAt: now,
        updatedAt: now,
      });

      const result = await ensureBackupEnvironment({
        config: newConfig,
        db: connection.db,
        now: () => now,
      });

      expect(result.ok).toBe(false);
      expect(result.alert).toMatchObject({
        kind: "backup_path_drift",
        previousProjectPath: oldConfig.projectPath,
        previousStorePath: oldConfig.storePath,
        currentProjectPath: newConfig.projectPath,
        currentStorePath: newConfig.storePath,
      });
      expect(existsSync(join(newConfig.projectPath, ".git"))).toBe(false);
    } finally {
      connection.close();
    }
  });

  it("updates the stamp when paths drift but no memory data exists", async () => {
    const root = await makeRoot();
    const oldConfig = createConfig(root, "old-data", "old-storage");
    const newConfig = createConfig(root, "new-data", "new-storage");
    const connection = initializeDatabase(newConfig);
    try {
      await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
        id: "default",
        projectPath: oldConfig.projectPath,
        storePath: oldConfig.storePath,
        gitRemote: "origin",
        gitRemoteUrl: null,
        gitBranch: "main",
        createdAt: now,
        updatedAt: now,
      });

      const result = await ensureBackupEnvironment({
        config: newConfig,
        db: connection.db,
        now: () => now,
      });

      expect(result.ok).toBe(true);
      expect(await connection.repositories.backupEnvironment.getBackupEnvironmentStamp())
        .toMatchObject({
          projectPath: newConfig.projectPath,
          storePath: newConfig.storePath,
        });
    } finally {
      connection.close();
    }
  });

  it("refuses to write memory content while a drift alert is active", async () => {
    const root = await makeRoot();
    const config = createConfig(root);
    await writeContent(config.storePath, "existing");
    const connection = initializeDatabase(config);
    try {
      await expect(
        assertBackupEnvironmentReady({
          config,
          db: connection.db,
          now: () => now,
        }),
      ).rejects.toBeInstanceOf(BackupEnvironmentFailsafeError);
    } finally {
      connection.close();
    }
  });

  it("reports active alerts through the status loader", async () => {
    const root = await makeRoot();
    const config = createConfig(root);
    await writeContent(config.storePath, "existing");
    const connection = initializeDatabase(config);
    try {
      const status = await getBackupFailsafeStatus({
        config,
        db: connection.db,
        now: () => now,
      });

      expect(status.alert).toMatchObject({
        kind: "backup_path_drift",
        currentProjectPath: config.projectPath,
      });
    } finally {
      connection.close();
    }
  });
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "trauma-backup-env-"));
  tempDirs.push(root);
  return root;
}

function createConfig(
  root: string,
  projectName = "data",
  storeName = "storage",
): ResolvedTraumaConfig {
  return {
    configFilePath: join(root, "trauma.config.json"),
    projectPath: join(root, projectName),
    storePath: join(root, projectName, storeName),
    databasePath: join(root, ".trauma/trauma.sqlite"),
    backup: {
      git: {
        enabled: true,
        remote: "origin",
        branch: "main",
        push: false,
        commitMessageTemplate: "backup memory {memoryId}",
      },
    },
  };
}

function createMemoryRow() {
  return {
    id: "memory-1",
    url: "https://example.com",
    title: "Existing memory",
    description: null,
    faviconUrl: null,
    contentPath: "memories/memory-1/CONTENT.md",
    extractionStatus: "success" as const,
    extractionError: null,
    backupStatus: "pending" as const,
    lastBackupAt: null,
    lastBackupError: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function writeContent(storePath: string, memoryId: string) {
  const directory = join(storePath, "memories", memoryId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "CONTENT.md"), "# Memory\n", "utf8");
}

function initializeGitRepository(projectPath: string) {
  execFileSync("git", ["init", "--initial-branch=main"], {
    cwd: projectPath,
    stdio: "ignore",
  });
}
