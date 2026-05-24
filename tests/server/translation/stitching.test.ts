import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MemoryBackupQueue } from "../../../src/server/backup";
import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { createMemoryContentFixture } from "../../../src/server/store";
import { loadTranslationSourceSnapshot } from "../../../src/server/translation/source-loader";
import {
  commitTranslatedContent,
  validateFinalTranslatedContent,
} from "../../../src/server/translation/stitching";

const tempRoots: string[] = [];
const now = new Date("2026-05-21T00:00:00.000Z");
const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f904";

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("translation stitching and atomic commit", () => {
  it("writes translated CONTENT.md, purges chunks, and enqueues backup", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    const source = await loadTranslationSourceSnapshot({ config, memoryId });
    const enqueued: unknown[] = [];
    const backupQueue: MemoryBackupQueue = {
      enqueue: async (input) => {
        enqueued.push(input);
        return { backupStatus: "queued" };
      },
    };
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
      const job = await connection.repositories.translations.createTranslationJob({
        chunkCount: 2,
        chunkerVersion: "chunker-v1",
        jobId: "job-stitch",
        langCode: "ja-JP",
        memoryId,
        model: "codex-test",
        now,
        promptPolicyVersion: "brilliant-v1",
        sourceHash: source.sourceHash,
      });
      await connection.repositories.translations.insertTranslationChunks("job-stitch", [
        {
          blockIds: ["b000001"],
          chunkIndex: 0,
          now,
          sourceChunkHash: "sha256:chunk-0",
          status: "complete",
        },
        {
          blockIds: ["b000002"],
          chunkIndex: 1,
          now,
          sourceChunkHash: "sha256:chunk-1",
          status: "complete",
        },
      ]);
      await connection.repositories.translations.updateTranslationChunk(
        "job-stitch",
        0,
        {
          projectionSpansJson: JSON.stringify([{
            blockId: "b000001",
            segmentId: "s000001",
            sourceMarkdownEnd: 18,
            sourceMarkdownStart: 2,
            sourceReaderEnd: 16,
            sourceReaderStart: 0,
            translatedMarkdownEnd: 4,
            translatedMarkdownStart: 2,
            translatedReaderEnd: 2,
            translatedReaderStart: 0,
          }]),
          status: "complete",
          translatedHash: "sha256:translated-0",
          translatedMarkdown: "# 翻訳\n\n",
          updatedAt: now,
        },
      );
      await connection.repositories.translations.updateTranslationChunk(
        "job-stitch",
        1,
        {
          projectionSpansJson: JSON.stringify([{
            blockId: "b000002",
            segmentId: "s000002",
            sourceMarkdownEnd: 25,
            sourceMarkdownStart: 20,
            sourceReaderEnd: 21,
            sourceReaderStart: 16,
            translatedMarkdownEnd: 3,
            translatedMarkdownStart: 0,
            translatedReaderEnd: 3,
            translatedReaderStart: 0,
          }]),
          status: "complete",
          translatedHash: "sha256:translated-1",
          translatedMarkdown: "本文。\n",
          updatedAt: now,
        },
      );

      const result = await commitTranslatedContent({
        backupQueue,
        chunks: await connection.repositories.translations.getTranslationChunks(
          "job-stitch",
        ),
        config,
        job,
        now,
        repository: connection.repositories.translations,
      });

      expect(result).toMatchObject({
        outputPath: `memories/${memoryId}/ja-JP/CONTENT.md`,
        readerUrl: `/memories/ja-JP/${memoryId}`,
      });
      expect(enqueued).toEqual([
        {
          contentPaths: [
            `memories/${memoryId}/ja-JP/CONTENT.md`,
            `memories/${memoryId}/ja-JP/TRANSLATION_MAP.json`,
          ],
          memoryId,
          reason: "translation_update",
        },
      ]);
      expect(
        await connection.repositories.translations.getTranslationChunks(
          "job-stitch",
        ),
      ).toEqual([
        expect.objectContaining({
          projectionSpansJson: null,
          status: "purged",
          translatedMarkdown: null,
        }),
        expect.objectContaining({
          projectionSpansJson: null,
          status: "purged",
          translatedMarkdown: null,
        }),
      ]);
    } finally {
      connection.close();
    }
  });

  it("rejects an empty stitched document before writing translated CONTENT.md", () => {
    expect(() =>
      validateFinalTranslatedContent({
        body: "\n\n",
        expectedFrontmatter: "---\nid: test\n---\n",
        output: "---\nid: test\n---\n\n\n",
      }),
    ).toThrow("Translated document body is empty.");
  });
});

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
  const root = await mkdtemp(join(tmpdir(), "trauma-translation-stitch-"));
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
