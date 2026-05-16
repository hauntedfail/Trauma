import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MemoryBackupQueue } from "../../../src/server/backup";
import { initializeDatabase } from "../../../src/server/db";
import { writeFlashbackMetadataExport } from "../../../src/server/flashbacks/export";
import { deleteMemory } from "../../../src/server/memories/delete-memory";
import { writeMemoryContent } from "../../../src/server/store";
import {
  loadRouteConfig,
  routeMemoryId,
  routeNow,
  seedRouteMemory,
  writeRouteConfig,
} from "../routes/api-test-helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("delete memory service", () => {
  it("queues deleted memory content and Flashback export paths for git backup", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });
    await writeFlashbackExport(config.storePath, routeMemoryId);
    const connection = initializeDatabase(config);
    const enqueued: Parameters<MemoryBackupQueue["enqueue"]>[0][] = [];
    const backupQueue = {
      enqueue: async (input) => {
        enqueued.push(input);
        return { backupStatus: "queued" };
      },
    } satisfies MemoryBackupQueue;

    try {
      await expect(
        deleteMemory({
          backupQueue,
          config,
          db: connection.db,
          memoryId: routeMemoryId,
        }),
      ).resolves.toEqual({ status: "deleted" });
    } finally {
      connection.close();
    }

    expect(enqueued).toEqual([
      {
        memoryId: routeMemoryId,
        contentPaths: [
          `memories/${routeMemoryId}/CONTENT.md`,
          `memories/${routeMemoryId}/FLASHBACKS.json`,
        ],
        reason: "memory_deletion",
      },
    ]);
  });

  it("returns deleted with a warning when backup enqueue fails after local deletion", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });
    const connection = initializeDatabase(config);
    const backupQueue = {
      enqueue: async () => {
        throw new Error("backup queue is down");
      },
    } satisfies MemoryBackupQueue;

    try {
      await expect(
        deleteMemory({
          backupQueue,
          config,
          db: connection.db,
          memoryId: routeMemoryId,
        }),
      ).resolves.toEqual({
        status: "deleted",
        warnings: [
          {
            kind: "backup_enqueue_failed",
            error: "backup queue is down",
          },
        ],
      });
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ count: 0 });
    } finally {
      connection.close();
    }

    await expect(access(join(config.storePath, "memories", routeMemoryId)))
      .rejects.toThrow();
  });

  it("returns a partial failure when staged content cleanup fails", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });
    const connection = initializeDatabase(config);

    try {
      const result = await deleteMemory({
        config,
        db: connection.db,
        fileSystem: {
          rm: async () => {
            throw new Error("staging cleanup denied");
          },
        },
        memoryId: routeMemoryId,
      });

      expect(result).toMatchObject({
        status: "failed",
        partial: "content_cleanup_failed",
      });
      expect(result.status === "failed" ? result.error : "").toContain(
        "staging cleanup denied",
      );
      expect(result.status === "failed" ? result.error : "").toContain(
        ".delete-staging",
      );
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ count: 0 });
    } finally {
      connection.close();
    }
  });

  it("restores staged content when database deletion fails", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });

    const connection = initializeDatabase(config);
    try {
      const result = await deleteMemory({
        config,
        db: connection.db,
        memoryId: routeMemoryId,
        repositories: {
          memories: {
            findDeletionTarget: async () => ({
              id: routeMemoryId,
              contentPath: `memories/${routeMemoryId}/CONTENT.md`,
            }),
            deleteMemoryRecord: async () => {
              throw new Error("database delete failed");
            },
          },
        },
      });

      expect(result).toEqual({
        status: "failed",
        error: "database delete failed",
      });
    } finally {
      connection.close();
    }
    await expect(
      readFile(join(config.storePath, "memories", routeMemoryId, "CONTENT.md"), "utf8"),
    ).resolves.toContain("# Route Memory");
  });

  it("deletes the row when the content directory is already missing", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);
    const connection = initializeDatabase(config);

    try {
      await expect(
        deleteMemory({
          config,
          db: connection.db,
          memoryId: routeMemoryId,
        }),
      ).resolves.toEqual({ status: "deleted" });
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ count: 0 });
    } finally {
      connection.close();
    }
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-delete-memory-"));
  tempDirs.push(root);
  return root;
}

async function writeFlashbackExport(
  storePath: string,
  memoryId: string,
): Promise<void> {
  await writeFlashbackMetadataExport({
    config: { storePath },
    memoryId,
    flashbacks: [],
  });
}
