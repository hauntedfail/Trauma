import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MemoryBackupQueue } from "../../../src/server/backup";
import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { createMemoryContentFixture } from "../../../src/server/store";
import {
  runTranslationJob,
  startTranslationJob,
} from "../../../src/server/translation/runner";
import type {
  CodexChunkOutput,
  TranslationChunk,
} from "../../../src/server/translation/types";
import type { TranslationClient } from "../../../src/server/translation/codex-app-server";

const tempRoots: string[] = [];
const now = new Date("2026-05-21T00:00:00.000Z");
const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f905";

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("translation runner", () => {
  it("starts a job, translates chunks, commits output, and reuses current output", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    const enqueued: unknown[] = [];
    const backupQueue: MemoryBackupQueue = {
      enqueue: async (input) => {
        enqueued.push(input);
        return { backupStatus: "queued" };
      },
    };

    const started = await startTranslationJob({
      backupQueue,
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000001",
      memoryId,
      now,
      schedule: () => undefined,
    });
    expect(started).toMatchObject({
      status: "started",
      lang_code: "ja-JP",
      event_url: "/api/translation-jobs/019e3906-0000-7000-8000-000000000001/events",
    });

    await runTranslationJob(started.job_id, {
      backupQueue,
      client,
      config,
    });

    expect(enqueued).toEqual([
      {
        contentPath: `memories/${memoryId}/ja-JP/CONTENT.md`,
        memoryId,
        reason: "translation_update",
      },
    ]);

    await expect(
      startTranslationJob({
        backupQueue,
        client,
        config,
        memoryId,
        now,
        schedule: () => undefined,
      }),
    ).resolves.toMatchObject({
      status: "current",
      reader_url: `/memories/ja-JP/${memoryId}`,
    });
  });
});

class FakeTranslationClient implements TranslationClient {
  async probe(): Promise<void> {}

  async translateChunk(input: {
    chunk: TranslationChunk;
  }): Promise<CodexChunkOutput> {
    return {
      chunk_index: input.chunk.chunkIndex,
      blocks: input.chunk.blockIds.map((id) => ({
        id,
        translated_markdown: input.chunk.sourceMarkdown.replaceAll(
          "Brilliant Source",
          "華麗なソース",
        ).replaceAll("Body.", "本文。"),
      })),
      warnings: [],
    };
  }
}

async function createMemoryRow(config: ResolvedTraumaConfig): Promise<void> {
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.memories.create({
      id: memoryId,
      url: "https://example.com/brilliant",
      title: "Brilliant Source",
      description: null,
      faviconUrl: null,
      contentPath: `memories/${memoryId}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      lastBackupAt: null,
      lastBackupError: null,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }
}

async function writeSourceContent(config: ResolvedTraumaConfig): Promise<void> {
  const filePath = join(config.storePath, "memories", memoryId, "CONTENT.md");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    createMemoryContentFixture({
      frontmatter: {
        capturedAt: now.toISOString(),
        extractionStatus: "success",
        id: memoryId,
        title: "Brilliant Source",
        url: "https://example.com/brilliant",
      },
      markdown: "# Brilliant Source\n\nBody.",
    }),
    "utf8",
  );
}

async function createConfig(): Promise<ResolvedTraumaConfig> {
  const root = await mkdtemp(join(tmpdir(), "trauma-translation-runner-"));
  tempRoots.push(root);
  return {
    configFilePath: join(root, "trauma.config.json"),
    projectPath: join(root, "data"),
    storePath: join(root, "data/storage"),
    databasePath: join(root, ".trauma/trauma.sqlite"),
    backup: {
      git: {
        enabled: false,
        remote: "origin",
        branch: "main",
        push: false,
        commitMessageTemplate: "backup {action} {memoryId}",
      },
    },
  };
}
