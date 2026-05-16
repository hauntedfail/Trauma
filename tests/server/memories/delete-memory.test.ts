import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MemoryBackupQueue } from "../../../src/server/backup";
import { initializeDatabase } from "../../../src/server/db";
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
  it("queues deleted memory content paths for git backup without blocking local deletion", async () => {
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
        contentPaths: [`memories/${routeMemoryId}/CONTENT.md`],
        reason: "memory_deletion",
      },
    ]);
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-delete-memory-"));
  tempDirs.push(root);
  return root;
}
