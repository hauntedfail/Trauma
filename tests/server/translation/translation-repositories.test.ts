import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeDatabase } from "../../../src/server/db";
import type { ResolvedTraumaConfig } from "../../../src/server/config";

const tempRoots: string[] = [];
const now = new Date("2026-05-21T00:00:00.000Z");
const later = new Date("2026-05-21T00:01:00.000Z");
const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f901";

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("translation repositories", () => {
  it("creates, claims, completes, purges, and repairs Brilliant jobs", async () => {
    const config = await createConfig();
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
        jobId: "job-brilliant",
        memoryId,
        langCode: "ja-JP",
        sourceHash: "sha256:source",
        model: "codex-test",
        promptPolicyVersion: "brilliant-v1",
        chunkerVersion: "chunker-v1",
        chunkCount: 2,
        now,
      });
      await connection.repositories.translations.insertTranslationChunks("job-brilliant", [
        {
          chunkIndex: 0,
          sourceChunkHash: "sha256:chunk-0",
          blockIds: ["b000001"],
          status: "pending",
          now,
        },
        {
          chunkIndex: 1,
          sourceChunkHash: "sha256:chunk-1",
          blockIds: ["b000002"],
          status: "pending",
          now,
        },
      ]);

      expect(job.status).toBe("pending");
      expect(
        await connection.repositories.translations.claimTranslationJob(
          "job-brilliant",
          "pending",
          later,
        ),
      ).toBe(true);
      expect(
        await connection.repositories.translations.claimTranslationJob(
          "job-brilliant",
          "pending",
          later,
        ),
      ).toBe(false);

      await connection.repositories.translations.updateTranslationChunk(
        "job-brilliant",
        0,
        {
          status: "complete",
          translatedMarkdown: "# 翻訳",
          translatedHash: "sha256:translated-0",
          updatedAt: later,
        },
      );
      await connection.repositories.translations.updateTranslationChunk(
        "job-brilliant",
        1,
        {
          status: "retrying",
          retryCount: 1,
          error: {
            code: "validation_failed",
            message: "Translated chunk failed validation.",
            action: "retry",
          },
          updatedAt: later,
        },
      );

      expect(
        await connection.repositories.translations.countTranslationChunksByStatus(
          "job-brilliant",
        ),
      ).toMatchObject({
        complete: 1,
        purged: 0,
        retrying: 1,
      });

      await connection.repositories.translations.updateTranslationChunk(
        "job-brilliant",
        1,
        {
          status: "complete",
          translatedMarkdown: "本文",
          translatedHash: "sha256:translated-1",
          error: null,
          updatedAt: later,
        },
      );
      await connection.repositories.translations.updateTranslationJobStatus(
        "job-brilliant",
        "complete",
        {
          outputPath: `memories/${memoryId}/ja-JP/CONTENT.md`,
          outputHash: "sha256:output",
          completedAt: later,
          updatedAt: later,
        },
      );
      await connection.repositories.translations.purgeCompletedTranslationChunks(
        "job-brilliant",
        later,
      );

      expect(
        await connection.repositories.translations.findCompleteTranslationRecord(
          memoryId,
          "ja-JP",
          "sha256:source",
        ),
      ).toMatchObject({
        jobId: "job-brilliant",
        outputPath: `memories/${memoryId}/ja-JP/CONTENT.md`,
      });
      expect(
        await connection.repositories.translations.getTranslationChunks(
          "job-brilliant",
        ),
      ).toEqual([
        expect.objectContaining({
          chunkIndex: 0,
          status: "purged",
          translatedMarkdown: null,
          translatedHash: "sha256:translated-0",
        }),
        expect.objectContaining({
          chunkIndex: 1,
          status: "purged",
          translatedMarkdown: null,
          translatedHash: "sha256:translated-1",
        }),
      ]);

      await connection.repositories.translations.markTranslationUnavailable(
        "job-brilliant",
        "output_missing",
        later,
      );
      expect(
        await connection.repositories.translations.getTranslationJob(
          "job-brilliant",
        ),
      ).toMatchObject({
        status: "unavailable",
        error: {
          code: "translation_unavailable",
          action: "start_fresh_translation",
          reason: "output_missing",
        },
      });
    } finally {
      connection.close();
    }
  });
});

async function createConfig(): Promise<ResolvedTraumaConfig> {
  const root = await mkdtemp(join(tmpdir(), "trauma-translation-repo-"));
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
