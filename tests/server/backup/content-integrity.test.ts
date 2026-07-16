import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { findInconsistentSuccessfulBackupContent } from "../../../src/server/backup/content-integrity";
import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";

const tempDirs: string[] = [];
const now = new Date("2026-07-17T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("successful backup content integrity", () => {
  it("loads the tracked Git index once for every successful memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-content-integrity-"));
    tempDirs.push(root);
    const config = createConfig(root);
    const rows = ["memory-one", "memory-two", "memory-three"].map(
      (memoryId, index) => ({
        contentPath: `memories/${memoryId}/CONTENT.md`,
        memoryId,
        createdAt: new Date(now.getTime() + index),
      }),
    );
    await Promise.all(
      rows.map(async ({ contentPath }) => {
        const absolutePath = join(config.storePath, contentPath);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, "# Backed up\n", "utf8");
      }),
    );

    const connection = initializeDatabase(config);
    try {
      for (const row of rows) {
        await connection.repositories.memories.create({
          id: row.memoryId,
          url: `https://example.com/${row.memoryId}`,
          title: row.memoryId,
          description: null,
          faviconUrl: null,
          contentPath: row.contentPath,
          extractionStatus: "success",
          extractionError: null,
          backupStatus: "success",
          lastBackupAt: now,
          lastBackupError: null,
          createdAt: row.createdAt,
          updatedAt: row.createdAt,
        });
      }

      const listTrackedPaths = vi.fn(async () =>
        new Set(rows.map(({ contentPath }) => `store/${contentPath}`))
      );

      await expect(
        findInconsistentSuccessfulBackupContent(config, connection.db, {
          listTrackedPaths,
        }),
      ).resolves.toBeNull();
      expect(listTrackedPaths).toHaveBeenCalledTimes(1);
      expect(listTrackedPaths).toHaveBeenCalledWith(config.projectPath);
    } finally {
      connection.close();
    }
  });
});

function createConfig(root: string): ResolvedTraumaConfig {
  return {
    configFilePath: join(root, "trauma.config.json"),
    projectPath: join(root, "project"),
    storePath: join(root, "project", "store"),
    databasePath: join(root, ".trauma", "trauma.sqlite"),
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
