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
        reasoningEffort: "high",
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
      expect(job.model).toBe("codex-test");
      expect(job.reasoningEffort).toBe("high");
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
      await connection.repositories.translations.replaceProjectionSpansForJob(
        "job-brilliant",
        [
          createProjectionSpan({
            blockId: "b000001",
            segmentId: "s000001",
            spanIndex: 1,
          }),
          createProjectionSpan({
            blockId: "b000002",
            segmentId: "s000002",
            spanIndex: 0,
          }),
        ],
      );

      expect(
        await connection.repositories.translations.listCurrentProjectionSpans({
          langCode: "ja-JP",
          memoryId,
          outputHash: "sha256:output",
          sourceHash: "sha256:source",
        }),
      ).toEqual([
        expect.objectContaining({
          segmentId: "s000002",
          spanIndex: 0,
        }),
        expect.objectContaining({
          segmentId: "s000001",
          spanIndex: 1,
        }),
      ]);
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

      await connection.repositories.translations.deleteProjectionSpansForJob(
        "job-brilliant",
      );
      expect(
        await connection.repositories.translations.listCurrentProjectionSpans({
          langCode: "ja-JP",
          memoryId,
          outputHash: "sha256:output",
          sourceHash: "sha256:source",
        }),
      ).toEqual([]);
    } finally {
      connection.close();
    }
  });

  it("uses compare-and-set transitions for translation finalization", async () => {
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
      await connection.repositories.translations.createTranslationJob({
        jobId: "job-cas",
        memoryId,
        langCode: "ja-JP",
        sourceHash: "sha256:source-cas",
        model: null,
        reasoningEffort: null,
        promptPolicyVersion: "brilliant-v1",
        chunkerVersion: "chunker-v1",
        chunkCount: 1,
        now,
      });
      await expect(
        connection.repositories.translations.claimTranslationJob(
          "job-cas",
          "pending",
          later,
        ),
      ).resolves.toBe(true);
      await expect(
        connection.repositories.translations.requestRunningTranslationJobCancellation(
          "job-cas",
          later,
        ),
      ).resolves.toBe(true);
      await expect(
        connection.repositories.translations.transitionTranslationJobStatus(
          "job-cas",
          "running",
          "stitching",
          { updatedAt: later },
        ),
      ).resolves.toBe(false);
      await expect(
        connection.repositories.translations.getTranslationJob("job-cas"),
      ).resolves.toMatchObject({ status: "cancel_requested" });
    } finally {
      connection.close();
    }
  });

  it("keeps translation job model and reasoning effort as historical attempt state", async () => {
    const config = await createConfig();
    const connection = initializeDatabase(config);
    try {
      await createMemoryRow(connection);
      await connection.repositories.settings.updateCodexTranslationDefaults({
        model: "gpt-5.5",
        reasoningEffort: "high",
        updatedAt: now,
      });

      await connection.repositories.translations.createTranslationJob({
        jobId: "job-model-snapshot",
        memoryId,
        langCode: "ja-JP",
        sourceHash: "sha256:model-snapshot",
        model: "gpt-5.5",
        reasoningEffort: "high",
        promptPolicyVersion: "brilliant-v1",
        chunkerVersion: "chunker-v1",
        chunkCount: 1,
        now,
      });
      await connection.repositories.settings.updateCodexTranslationDefaults({
        model: "gpt-5.3",
        reasoningEffort: "medium",
        updatedAt: later,
      });

      await expect(
        connection.repositories.translations.getTranslationJob(
          "job-model-snapshot",
        ),
      ).resolves.toMatchObject({
        model: "gpt-5.5",
        reasoningEffort: "high",
      });
      await expect(
        connection.repositories.settings.getSettings(later),
      ).resolves.toMatchObject({
        codexTranslationModel: "gpt-5.3",
        codexTranslationReasoningEffort: "medium",
      });
    } finally {
      connection.close();
    }
  });

  it("round-trips safe translation validation diagnostics in chunk errors", async () => {
    const config = await createConfig();
    const connection = initializeDatabase(config);
    try {
      await createMemoryRow(connection);
      await createTranslationJobWithChunk(connection, "job-diagnostics");

      await connection.repositories.translations.updateTranslationChunk(
        "job-diagnostics",
        0,
        {
          status: "failed",
          retryCount: 1,
          error: {
            code: "validation_failed",
            message: "Codex output changed inline code.",
            action: "retry",
            diagnostics: [
              {
                kind: "markdown_structure",
                message: "Codex output changed inline code.",
                chunkIndex: 0,
                segmentId: "s000001",
                blockId: "b000001",
                sourceEntry: {
                  kind: "inline_code",
                  valuePreview: "AGENTS.md",
                },
                translatedEntry: {
                  kind: "inline_code",
                  valuePreview: "agents.md",
                },
              },
            ],
          },
          updatedAt: later,
        },
      );

      await expect(
        connection.repositories.translations.getTranslationChunks("job-diagnostics"),
      ).resolves.toEqual([
        expect.objectContaining({
          error: expect.objectContaining({
            diagnostics: [
              expect.objectContaining({
                kind: "markdown_structure",
                sourceEntry: {
                  kind: "inline_code",
                  valuePreview: "AGENTS.md",
                },
              }),
            ],
          }),
        }),
      ]);
    } finally {
      connection.close();
    }
  });

  it("rejects malformed persisted translation diagnostics", async () => {
    const config = await createConfig();
    const connection = initializeDatabase(config);
    try {
      await createMemoryRow(connection);
      await createTranslationJobWithChunk(connection, "job-bad-diagnostics");

      await connection.repositories.translations.updateTranslationChunk(
        "job-bad-diagnostics",
        0,
        {
          status: "failed",
          error: {
            code: "validation_failed",
            message: "bad diagnostics",
            action: "retry",
            diagnostics: "not-an-array",
          } as never,
          updatedAt: later,
        },
      );

      await expect(
        connection.repositories.translations.getTranslationChunks(
          "job-bad-diagnostics",
        ),
      ).rejects.toThrow(/Invalid persisted translation error/);
    } finally {
      connection.close();
    }
  });

  it("rejects persisted translation diagnostics with unexpected keys", async () => {
    const config = await createConfig();
    const connection = initializeDatabase(config);
    try {
      await createMemoryRow(connection);
      await createTranslationJobWithChunk(connection, "job-extra-diagnostic");

      await connection.repositories.translations.updateTranslationChunk(
        "job-extra-diagnostic",
        0,
        {
          status: "failed",
          error: {
            code: "validation_failed",
            message: "diagnostic contains unsafe extra data",
            action: "retry",
            diagnostics: [
              {
                kind: "markdown_structure",
                message: "Codex output changed inline code.",
                chunkIndex: 0,
                rawPrompt: "do not return this",
              },
            ],
          } as never,
          updatedAt: later,
        },
      );

      await expect(
        connection.repositories.translations.getTranslationChunks(
          "job-extra-diagnostic",
        ),
      ).rejects.toThrow(/Invalid persisted translation error/);

      await createTranslationJobWithChunk(connection, "job-extra-entry");
      await connection.repositories.translations.updateTranslationChunk(
        "job-extra-entry",
        0,
        {
          status: "failed",
          error: {
            code: "validation_failed",
            message: "diagnostic entry contains unsafe extra data",
            action: "retry",
            diagnostics: [
              {
                kind: "markdown_structure",
                message: "Codex output changed inline code.",
                chunkIndex: 0,
                sourceEntry: {
                  kind: "inline_code",
                  valuePreview: "AGENTS.md",
                  rawSource: "do not return this",
                },
              },
            ],
          } as never,
          updatedAt: later,
        },
      );

      await expect(
        connection.repositories.translations.getTranslationChunks(
          "job-extra-entry",
        ),
      ).rejects.toThrow(/Invalid persisted translation error/);
    } finally {
      connection.close();
    }
  });
});

async function createMemoryRow(
  connection: ReturnType<typeof initializeDatabase>,
): Promise<void> {
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
}

async function createTranslationJobWithChunk(
  connection: ReturnType<typeof initializeDatabase>,
  jobId: string,
): Promise<void> {
  await connection.repositories.translations.createTranslationJob({
    jobId,
    memoryId,
    langCode: "ja-JP",
    sourceHash: `sha256:${jobId}`,
    model: null,
    reasoningEffort: null,
    promptPolicyVersion: "brilliant-v1",
    chunkerVersion: "chunker-v1",
    chunkCount: 1,
    now,
  });
  await connection.repositories.translations.insertTranslationChunks(jobId, [
    {
      chunkIndex: 0,
      sourceChunkHash: `sha256:${jobId}-chunk`,
      blockIds: ["b000001"],
      status: "pending",
      now,
    },
  ]);
}

function createProjectionSpan(input: {
  blockId: string;
  segmentId: string;
  spanIndex: number;
}) {
  const offset = input.spanIndex * 10;
  return {
    blockId: input.blockId,
    createdAt: now,
    jobId: "job-brilliant",
    langCode: "ja-JP" as const,
    memoryId,
    outputHash: "sha256:output",
    segmentId: input.segmentId,
    sourceHash: "sha256:source",
    sourceMarkdownEnd: offset + 5,
    sourceMarkdownStart: offset,
    sourceReaderEnd: offset + 5,
    sourceReaderStart: offset,
    spanIndex: input.spanIndex,
    translatedMarkdownEnd: offset + 8,
    translatedMarkdownStart: offset,
    translatedReaderEnd: offset + 8,
    translatedReaderStart: offset,
    updatedAt: now,
  };
}

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
