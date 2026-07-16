import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import {
  persistMemoryCreationJournal,
  persistMemoryDeletionJournal,
  recoverInterruptedMemoryOperations,
  resolveMemoryDeletionStagingPath,
} from "../../../src/server/memories/operation-journal";
import {
  resolveMemoryContentPath,
  writeMemoryContent,
} from "../../../src/server/store/memory-content";

const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef991";
const now = new Date("2026-07-17T00:00:00.000Z");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

describe("memory operation journal recovery", () => {
  it("reconstructs a missing SQLite row for content written before create crashed", async () => {
    const config = await createConfig(false);
    const connection = initializeDatabase(config);
    const contentPath = resolveMemoryContentPath(config, memoryId);
    try {
      await persistMemoryCreationJournal({
        config,
        journal: {
          version: 1,
          kind: "memory_creation",
          memory: {
            id: memoryId,
            url: "https://example.com/recovered",
            title: "Recovered creation",
            description: "Recovered metadata",
            faviconUrl: null,
            contentPath: contentPath.relativePath,
            extractionStatus: "success",
            extractionError: null,
            read: false,
            backupStatus: "disabled",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        },
      });
      await writeMemoryContent({
        config,
        memoryId,
        overwrite: false,
        frontmatter: {
          id: memoryId,
          url: "https://example.com/recovered",
          title: "Recovered creation",
          capturedAt: now.toISOString(),
          extractionStatus: "success",
        },
        markdown: "# Recovered creation",
      });

      await expect(recoverInterruptedMemoryOperations({
        config,
        memories: connection.repositories.memories,
      })).resolves.toBe(1);
      await expect(connection.repositories.memories.findById(memoryId)).resolves.toMatchObject({
        id: memoryId,
        contentPath: contentPath.relativePath,
        backupStatus: "disabled",
      });
      await expect(readFile(contentPath.absolutePath, "utf8")).resolves.toContain(
        "# Recovered creation",
      );
      await expect(access(join(config.storePath, ".operations", `${memoryId}.json`)))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      connection.close();
    }
  });

  it("keeps a creation journal when its SQLite row outlives missing canonical content", async () => {
    const config = await createConfig(false);
    const connection = initializeDatabase(config);
    const contentPath = resolveMemoryContentPath(config, memoryId);
    const journalPath = join(config.storePath, ".operations", `${memoryId}.json`);
    try {
      await persistMemoryCreationJournal({
        config,
        journal: {
          version: 1,
          kind: "memory_creation",
          memory: {
            id: memoryId,
            url: "https://example.com/not-durable",
            title: "Missing canonical content",
            description: null,
            faviconUrl: null,
            contentPath: contentPath.relativePath,
            extractionStatus: "success",
            extractionError: null,
            read: false,
            backupStatus: "disabled",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        },
      });
      await connection.repositories.memories.create({
        id: memoryId,
        url: "https://example.com/not-durable",
        title: "Missing canonical content",
        description: null,
        faviconUrl: null,
        contentPath: contentPath.relativePath,
        extractionStatus: "success",
        extractionError: null,
        read: false,
        backupStatus: "disabled",
        lastBackupAt: null,
        lastBackupError: null,
        createdAt: now,
        updatedAt: now,
      });

      await expect(recoverInterruptedMemoryOperations({
        config,
        memories: connection.repositories.memories,
      })).rejects.toThrow("canonical content is missing");
      await expect(connection.repositories.memories.findById(memoryId))
        .resolves.toMatchObject({ id: memoryId });
      await expect(access(journalPath)).resolves.toBeNull();
    } finally {
      connection.close();
    }
  });

  it("restores staged content and a pending backup when delete crashed before row removal", async () => {
    const config = await createConfig(true);
    const connection = initializeDatabase(config);
    const contentPath = resolveMemoryContentPath(config, memoryId);
    const stagingPath = resolveMemoryDeletionStagingPath({
      memoryId,
      storePath: config.storePath,
      uniqueSuffix: "test-crash",
    });
    try {
      await connection.repositories.memories.create({
        id: memoryId,
        url: "https://example.com/delete-recovery",
        title: "Delete recovery",
        description: null,
        faviconUrl: null,
        contentPath: contentPath.relativePath,
        extractionStatus: "success",
        extractionError: null,
        read: false,
        backupStatus: "success",
        lastBackupAt: now,
        lastBackupError: null,
        createdAt: now,
        updatedAt: now,
      });
      await writeMemoryContent({
        config,
        memoryId,
        frontmatter: {
          id: memoryId,
          url: "https://example.com/delete-recovery",
          title: "Delete recovery",
          capturedAt: now.toISOString(),
          extractionStatus: "success",
        },
        markdown: "# Restore me",
      });
      await persistMemoryDeletionJournal({
        config,
        journal: {
          version: 1,
          kind: "memory_deletion",
          memoryId,
          contentPath: contentPath.relativePath,
          stagingPath: stagingPath.relativePath,
        },
      });
      await mkdir(dirname(stagingPath.absolutePath), { recursive: true });
      await rename(dirname(contentPath.absolutePath), stagingPath.absolutePath);

      await expect(recoverInterruptedMemoryOperations({
        config,
        memories: connection.repositories.memories,
        now: () => now,
      })).resolves.toBe(1);
      await expect(readFile(contentPath.absolutePath, "utf8")).resolves.toContain(
        "# Restore me",
      );
      await expect(connection.repositories.memories.findById(memoryId)).resolves.toMatchObject({
        backupStatus: "pending",
        lastBackupAt: null,
      });
      await expect(access(stagingPath.absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      connection.close();
    }
  });

  it("removes staged plaintext when delete crashed after its SQLite row was removed", async () => {
    const config = await createConfig(false);
    const connection = initializeDatabase(config);
    const contentPath = resolveMemoryContentPath(config, memoryId);
    const stagingPath = resolveMemoryDeletionStagingPath({
      memoryId,
      storePath: config.storePath,
      uniqueSuffix: "row-removed",
    });
    try {
      await writeMemoryContent({
        config,
        memoryId,
        frontmatter: {
          id: memoryId,
          url: "https://example.com/orphaned-canonical",
          title: "Orphaned canonical",
          capturedAt: now.toISOString(),
          extractionStatus: "success",
        },
        markdown: "# Orphaned canonical plaintext",
      });
      await mkdir(stagingPath.absolutePath, { recursive: true });
      await writeFile(join(stagingPath.absolutePath, "CONTENT.md"), "plaintext", "utf8");
      await persistMemoryDeletionJournal({
        config,
        journal: {
          version: 1,
          kind: "memory_deletion",
          memoryId,
          contentPath: contentPath.relativePath,
          stagingPath: stagingPath.relativePath,
        },
      });

      await expect(recoverInterruptedMemoryOperations({
        config,
        memories: connection.repositories.memories,
      })).resolves.toBe(1);
      await expect(access(stagingPath.absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(dirname(contentPath.absolutePath)))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(join(config.storePath, ".operations", `${memoryId}.json`)))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      connection.close();
    }
  });

  it("finishes a deletion when its row remains after both content locations disappeared", async () => {
    const config = await createConfig(false);
    const connection = initializeDatabase(config);
    const contentPath = resolveMemoryContentPath(config, memoryId);
    const stagingPath = resolveMemoryDeletionStagingPath({
      memoryId,
      storePath: config.storePath,
      uniqueSuffix: "missing-before-row-delete",
    });
    try {
      await connection.repositories.memories.create({
        id: memoryId,
        url: "https://example.com/missing-delete",
        title: "Missing delete",
        description: null,
        faviconUrl: null,
        contentPath: contentPath.relativePath,
        extractionStatus: "success",
        extractionError: null,
        read: false,
        backupStatus: "disabled",
        lastBackupAt: null,
        lastBackupError: null,
        createdAt: now,
        updatedAt: now,
      });
      await persistMemoryDeletionJournal({
        config,
        journal: {
          version: 1,
          kind: "memory_deletion",
          memoryId,
          contentPath: contentPath.relativePath,
          stagingPath: stagingPath.relativePath,
        },
      });

      await expect(recoverInterruptedMemoryOperations({
        config,
        memories: connection.repositories.memories,
      })).resolves.toBe(1);
      await expect(connection.repositories.memories.findById(memoryId))
        .resolves.toBeUndefined();
      await expect(access(join(config.storePath, ".operations", `${memoryId}.json`)))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      connection.close();
    }
  });

  it("keeps a missing-content deletion journal until its backup completes", async () => {
    const config = await createConfig(true);
    const connection = initializeDatabase(config);
    const contentPath = resolveMemoryContentPath(config, memoryId);
    const stagingPath = resolveMemoryDeletionStagingPath({
      memoryId,
      storePath: config.storePath,
      uniqueSuffix: "missing-before-backup",
    });
    const journalPath = join(config.storePath, ".operations", `${memoryId}.json`);
    const attemptedBackups: unknown[] = [];
    const observedBackupStatuses: unknown[] = [];
    try {
      await connection.repositories.memories.create({
        id: memoryId,
        url: "https://example.com/missing-delete-backup",
        title: "Missing delete backup",
        description: null,
        faviconUrl: null,
        contentPath: contentPath.relativePath,
        extractionStatus: "success",
        extractionError: null,
        read: false,
        backupStatus: "success",
        lastBackupAt: now,
        lastBackupError: null,
        createdAt: now,
        updatedAt: now,
      });
      await persistMemoryDeletionJournal({
        config,
        journal: {
          version: 1,
          kind: "memory_deletion",
          memoryId,
          contentPath: contentPath.relativePath,
          stagingPath: stagingPath.relativePath,
        },
      });

      await expect(recoverInterruptedMemoryOperations({
        completeMissingDeletionBackup: async (deletion) => {
          attemptedBackups.push(deletion);
          observedBackupStatuses.push(
            (await connection.repositories.memories.findById(memoryId))
              ?.backupStatus,
          );
          throw new Error("backup unavailable");
        },
        config,
        memories: connection.repositories.memories,
      })).rejects.toThrow("backup unavailable");
      await expect(connection.repositories.memories.findById(memoryId))
        .resolves.toMatchObject({
          id: memoryId,
          backupStatus: "pending",
          lastBackupAt: null,
        });
      await expect(access(journalPath)).resolves.toBeNull();

      await expect(recoverInterruptedMemoryOperations({
        completeMissingDeletionBackup: async (deletion) => {
          attemptedBackups.push(deletion);
          observedBackupStatuses.push(
            (await connection.repositories.memories.findById(memoryId))
              ?.backupStatus,
          );
        },
        config,
        memories: connection.repositories.memories,
      })).resolves.toBe(1);
      expect(attemptedBackups).toEqual([
        {
          contentPaths: [
            `memories/${memoryId}/CONTENT.md`,
            `memories/${memoryId}/FLASHBACKS.json`,
            `memories/${memoryId}`,
          ],
          memoryId,
        },
        {
          contentPaths: [
            `memories/${memoryId}/CONTENT.md`,
            `memories/${memoryId}/FLASHBACKS.json`,
            `memories/${memoryId}`,
          ],
          memoryId,
        },
      ]);
      expect(observedBackupStatuses).toEqual(["pending", "pending"]);
      await expect(connection.repositories.memories.findById(memoryId))
        .resolves.toBeUndefined();
      await expect(access(journalPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      connection.close();
    }
  });

  it("preserves both copies when deletion recovery finds ambiguous content", async () => {
    const config = await createConfig(false);
    const connection = initializeDatabase(config);
    const contentPath = resolveMemoryContentPath(config, memoryId);
    const stagingPath = resolveMemoryDeletionStagingPath({
      memoryId,
      storePath: config.storePath,
      uniqueSuffix: "ambiguous",
    });
    try {
      await connection.repositories.memories.create({
        id: memoryId,
        url: "https://example.com/ambiguous",
        title: "Ambiguous recovery",
        description: null,
        faviconUrl: null,
        contentPath: contentPath.relativePath,
        extractionStatus: "success",
        extractionError: null,
        read: false,
        backupStatus: "disabled",
        lastBackupAt: null,
        lastBackupError: null,
        createdAt: now,
        updatedAt: now,
      });
      await writeMemoryContent({
        config,
        memoryId,
        frontmatter: {
          id: memoryId,
          url: "https://example.com/ambiguous",
          title: "Ambiguous recovery",
          capturedAt: now.toISOString(),
          extractionStatus: "success",
        },
        markdown: "# Canonical copy",
      });
      await mkdir(stagingPath.absolutePath, { recursive: true });
      await writeFile(
        join(stagingPath.absolutePath, "CONTENT.md"),
        "# Staged copy",
        "utf8",
      );
      await persistMemoryDeletionJournal({
        config,
        journal: {
          version: 1,
          kind: "memory_deletion",
          memoryId,
          contentPath: contentPath.relativePath,
          stagingPath: stagingPath.relativePath,
        },
      });

      await expect(recoverInterruptedMemoryOperations({
        config,
        memories: connection.repositories.memories,
      })).rejects.toThrow("both canonical and staged content");
      await expect(readFile(contentPath.absolutePath, "utf8"))
        .resolves.toContain("Canonical copy");
      await expect(readFile(join(stagingPath.absolutePath, "CONTENT.md"), "utf8"))
        .resolves.toContain("Staged copy");
      await expect(access(join(config.storePath, ".operations", `${memoryId}.json`)))
        .resolves.toBeNull();
    } finally {
      connection.close();
    }
  });
});

async function createConfig(
  backupEnabled: boolean,
): Promise<ResolvedTraumaConfig> {
  const root = await mkdtemp(join(tmpdir(), "trauma-operation-journal-"));
  tempDirs.push(root);
  return {
    configFilePath: join(root, "trauma.config.json"),
    projectPath: join(root, "data"),
    storePath: join(root, "data", "store"),
    databasePath: join(root, ".trauma", "trauma.sqlite"),
    backup: {
      git: {
        enabled: backupEnabled,
        remote: "origin",
        branch: "main",
        push: false,
        commitMessageTemplate: "backup memory {memoryId}",
      },
    },
  };
}
