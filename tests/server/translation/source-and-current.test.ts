import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { loadReaderMemory } from "../../../src/server/reader/page-data";
import { createMemoryContentFixture } from "../../../src/server/store";
import { MemoryContentStoreError } from "../../../src/server/store";
import {
  repairUnavailableTranslation,
  resolveCompleteTranslationRecordReadOnly,
  resolveCurrentTranslationReadOnly,
} from "../../../src/server/translation/current-translation";
import {
  BRILLIANT_CHUNKER_VERSION,
  BRILLIANT_PROMPT_POLICY_VERSION,
} from "../../../src/server/translation/prompt";
import {
  TranslationOutputValidationError,
} from "../../../src/server/translation/errors";
import { loadTranslationSourceSnapshot } from "../../../src/server/translation/source-loader";
import { writeTranslatedContentAtomically } from "../../../src/server/translation/stitching";

const tempRoots: string[] = [];
const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f902";
const now = new Date("2026-05-21T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("translation source and current output", () => {
  it("maps missing source CONTENT.md to a typed missing-content error", async () => {
    const config = await createConfig();

    await expect(loadTranslationSourceSnapshot({ config, memoryId }))
      .rejects.toMatchObject({
        code: "missing_content",
      });
    await expect(loadTranslationSourceSnapshot({ config, memoryId }))
      .rejects.toBeInstanceOf(MemoryContentStoreError);
  });

  it("hashes the exact source CONTENT.md bytes and validates current translations", async () => {
    const config = await createConfig();
    const sourceContent = createMemoryContentFixture({
      frontmatter: {
        capturedAt: now.toISOString(),
        extractionStatus: "success",
        id: memoryId,
        title: "Brilliant Source",
        url: "https://arxiv.org/abs/2604.08224",
      },
      markdown: "# Brilliant Source\n\nAbstract\n\nBody text.\n\nReferences\n\n- Paper",
    });
    await writeSourceContent(config, sourceContent);
    const source = await loadTranslationSourceSnapshot({ config, memoryId });

    expect(source.sourceHash).toBe(
      `sha256:${createHash("sha256").update(sourceContent).digest("hex")}`,
    );
    expect(source.sourcePath).toBe(`memories/${memoryId}/CONTENT.md`);
    expect(source.documentType).toBe("paper");

    const connection = initializeDatabase(config);
    try {
      await connection.repositories.memories.create({
        id: memoryId,
        url: "https://arxiv.org/abs/2604.08224",
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
        chunkCount: 1,
        chunkerVersion: BRILLIANT_CHUNKER_VERSION,
        jobId: "job-current",
        langCode: "ja-JP",
        memoryId,
        model: "codex-test",
        now,
        promptPolicyVersion: BRILLIANT_PROMPT_POLICY_VERSION,
        sourceHash: source.sourceHash,
      });
      const outputPath = await writeTranslatedContentAtomically({
        config,
        jobId: "job-current",
        langCode: "ja-JP",
        markdown: sourceContent.replace("Body text.", "本文。"),
        memoryId,
      });
      const output = await import("node:fs/promises").then(({ readFile }) =>
        readFile(outputPath.absolutePath),
      );
      const outputHash = `sha256:${createHash("sha256").update(output).digest("hex")}`;
      await connection.repositories.translations.updateTranslationJobStatus(
        "job-current",
        "complete",
        {
          completedAt: now,
          outputHash,
          outputPath: outputPath.relativePath,
          updatedAt: now,
        },
      );

      expect(
        await resolveCurrentTranslationReadOnly({
          config,
          langCode: "ja-JP",
          memoryId,
          repository: connection.repositories.translations,
        }),
      ).toMatchObject({
        outputPath: `memories/${memoryId}/ja-JP/CONTENT.md`,
        readerUrl: `/memories/ja-JP/${memoryId}`,
        status: "current",
      });
      const completeJob =
        await connection.repositories.translations.getTranslationJob("job-current");
      expect(completeJob).not.toBeNull();
      expect(
        await resolveCompleteTranslationRecordReadOnly({
          config,
          job: completeJob!,
          langCode: "ja-JP",
          memoryId,
          sourceSnapshot: {
            ...source,
            sourceHash: "sha256:stale-source",
          },
        }),
      ).toEqual({
        status: "missing",
        sourceHash: "sha256:stale-source",
      });

      await expect(
        loadReaderMemory(memoryId, { config, langCode: "ja-JP" }),
      ).resolves.toMatchObject({
        content: {
          relativePath: `memories/${memoryId}/ja-JP/CONTENT.md`,
          variants: [
            {
              active: false,
              kind: "source",
              label: "Original",
              readerUrl: `/memories/${memoryId}`,
              relativePath: `memories/${memoryId}/CONTENT.md`,
            },
            {
              active: true,
              kind: "translation",
              label: "Japanese",
              langCode: "ja-JP",
              readerUrl: `/memories/ja-JP/${memoryId}`,
              relativePath: `memories/${memoryId}/ja-JP/CONTENT.md`,
            },
          ],
        },
        memory: { id: memoryId },
        rendered: {
          html: expect.stringContaining("本文。"),
        },
        status: "ready",
      });

      await rm(outputPath.absolutePath);
      await expect(
        loadReaderMemory(memoryId, { config, langCode: "ja-JP" }),
      ).resolves.toMatchObject({
        status: "content_missing",
      });
      expect(
        await connection.repositories.translations.getTranslationJob("job-current"),
      ).toMatchObject({ status: "complete" });
      const missing = await resolveCurrentTranslationReadOnly({
        config,
        langCode: "ja-JP",
        memoryId,
        repository: connection.repositories.translations,
      });
      expect(missing).toMatchObject({ reason: "output_missing", status: "unavailable" });
      if (missing.status === "unavailable") {
        await repairUnavailableTranslation({
          jobId: missing.job.jobId,
          reason: missing.reason,
          repository: connection.repositories.translations,
          now,
        });
      }
      expect(
        await connection.repositories.translations.getTranslationJob("job-current"),
      ).toMatchObject({ status: "unavailable" });
    } finally {
      connection.close();
    }
  });

  it("admits the exact source byte limit and rejects limit plus one before decoding", async () => {
    const config = await createConfig();
    const sourceContent = createSourceContent();
    const sourceBytes = Buffer.from(sourceContent);
    await writeSourceContent(config, sourceContent);

    await expect(loadTranslationSourceSnapshot({
      config,
      maxSourceBytes: sourceBytes.byteLength,
      memoryId,
    })).resolves.toMatchObject({
      byteSize: sourceBytes.byteLength,
    });

    const filePath = join(config.storePath, "memories", memoryId, "CONTENT.md");
    await writeFile(
      filePath,
      Buffer.concat([sourceBytes, Buffer.from([0xff])]),
    );
    await expect(loadTranslationSourceSnapshot({
      config,
      maxSourceBytes: sourceBytes.byteLength,
      memoryId,
    })).rejects.toMatchObject({
      name: "TranslationOutputValidationError",
      retryable: false,
    });
  });

  it("continues short positional reads and closes the admitted source handle", async () => {
    const config = await createConfig();
    const sourceBytes = Buffer.from(createSourceContent());
    const positions: number[] = [];
    const readEnds: number[] = [];
    const readBufferLengths: number[] = [];
    let closeCalls = 0;

    const source = await loadTranslationSourceSnapshot({
      config,
      maxSourceBytes: sourceBytes.byteLength,
      memoryId,
      openFile: async () => ({
        close: async () => {
          closeCalls += 1;
        },
        read: async (buffer, offset, length, position) => {
          positions.push(position);
          readEnds.push(position + length);
          readBufferLengths.push(buffer.byteLength);
          if (position >= sourceBytes.byteLength) {
            return { bytesRead: 0 };
          }
          const bytesRead = Math.min(
            7,
            length,
            sourceBytes.byteLength - position,
          );
          sourceBytes.copy(buffer, offset, position, position + bytesRead);
          return { bytesRead };
        },
      }),
    });

    expect(source.byteSize).toBe(sourceBytes.byteLength);
    expect(source.sourceHash).toBe(
      `sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`,
    );
    expect(positions[0]).toBe(0);
    expect(positions.at(-1)).toBe(sourceBytes.byteLength);
    expect(Math.max(...readEnds)).toBe(sourceBytes.byteLength + 1);
    expect(new Set(readBufferLengths)).toEqual(
      new Set([sourceBytes.byteLength + 1]),
    );
    expect(closeCalls).toBe(1);
  });

  it("uses fixed-size demand buffers for a tiny source under a large limit", async () => {
    const config = await createConfig();
    const sourceBytes = Buffer.from(createSourceContent());
    const readBufferLengths: number[] = [];

    await expect(loadTranslationSourceSnapshot({
      config,
      maxSourceBytes: 20 * 1_024 * 1_024,
      memoryId,
      openFile: async () => ({
        close: async () => undefined,
        read: async (buffer, offset, length, position) => {
          readBufferLengths.push(buffer.byteLength);
          if (position >= sourceBytes.byteLength) {
            return { bytesRead: 0 };
          }
          const bytesRead = Math.min(
            length,
            sourceBytes.byteLength - position,
          );
          sourceBytes.copy(buffer, offset, position, position + bytesRead);
          return { bytesRead };
        },
      }),
    })).resolves.toMatchObject({ byteSize: sourceBytes.byteLength });

    expect(Math.max(...readBufferLengths)).toBeLessThanOrEqual(64 * 1_024);
  });

  it("decodes multibyte UTF-8 split across retained source chunks", async () => {
    const config = await createConfig();
    const marker = "界";
    const markerBytes = Buffer.from(marker);
    const unpaddedContent = createSourceContent(marker);
    const unpaddedMarkerOffset = Buffer.from(unpaddedContent).indexOf(markerBytes);
    const paddingLength = 64 * 1_024 - 1 - unpaddedMarkerOffset;
    expect(paddingLength).toBeGreaterThan(0);
    const sourceContent = createSourceContent(
      `${"a".repeat(paddingLength)}${marker}\n`,
    );
    const sourceBytes = Buffer.from(sourceContent);
    expect(sourceBytes.indexOf(markerBytes)).toBe(64 * 1_024 - 1);
    await writeSourceContent(config, sourceContent);

    const source = await loadTranslationSourceSnapshot({
      config,
      maxSourceBytes: sourceBytes.byteLength,
      memoryId,
    });

    expect(source.sourceMarkdown).toBe(sourceContent);
    expect(source.sourceHash).toBe(
      `sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`,
    );
  });

  it("detects a source that grows by one byte during bounded positional reads", async () => {
    const config = await createConfig();
    const initialBytes = Buffer.from("safe");
    const grownByte = Buffer.from([0xff]);
    const positions: number[] = [];
    let closeCalls = 0;

    await expect(loadTranslationSourceSnapshot({
      config,
      maxSourceBytes: initialBytes.byteLength,
      memoryId,
      openFile: async () => ({
        close: async () => {
          closeCalls += 1;
        },
        read: async (buffer, offset, length, position) => {
          positions.push(position);
          if (position < initialBytes.byteLength) {
            const bytesRead = Math.min(
              2,
              length,
              initialBytes.byteLength - position,
            );
            initialBytes.copy(buffer, offset, position, position + bytesRead);
            return { bytesRead };
          }
          if (position === initialBytes.byteLength) {
            grownByte.copy(buffer, offset);
            return { bytesRead: 1 };
          }
          return { bytesRead: 0 };
        },
      }),
    })).rejects.toBeInstanceOf(TranslationOutputValidationError);

    expect(positions).toEqual([0, 2, 4]);
    expect(closeCalls).toBe(1);
  });

  it("closes after a read error and preserves that primary error", async () => {
    const config = await createConfig();
    const readError = new Error("source read failed");
    let closeCalls = 0;

    await expect(loadTranslationSourceSnapshot({
      config,
      maxSourceBytes: 1,
      memoryId,
      openFile: async () => ({
        close: async () => {
          closeCalls += 1;
          throw new Error("source close failed");
        },
        read: async () => {
          throw readError;
        },
      }),
    })).rejects.toBe(readError);
    expect(closeCalls).toBe(1);
  });

  it("surfaces a close error after an otherwise successful bounded read", async () => {
    const config = await createConfig();
    const closeError = new Error("source close failed");

    await expect(loadTranslationSourceSnapshot({
      config,
      maxSourceBytes: 1,
      memoryId,
      openFile: async () => ({
        close: async () => {
          throw closeError;
        },
        read: async () => ({ bytesRead: 0 }),
      }),
    })).rejects.toBe(closeError);
  });

  it("propagates non-missing translated output read failures", async () => {
    const config = await createConfig();
    const sourceContent = createMemoryContentFixture({
      frontmatter: {
        capturedAt: now.toISOString(),
        extractionStatus: "success",
        id: memoryId,
        title: "Brilliant Source",
        url: "https://example.com/brilliant",
      },
      markdown: "# Brilliant Source\n\nBody text.",
    });
    await writeSourceContent(config, sourceContent);
    const source = await loadTranslationSourceSnapshot({ config, memoryId });
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
        chunkCount: 1,
        chunkerVersion: BRILLIANT_CHUNKER_VERSION,
        jobId: "job-output-read-failure",
        langCode: "ja-JP",
        memoryId,
        model: "codex-test",
        now,
        promptPolicyVersion: BRILLIANT_PROMPT_POLICY_VERSION,
        sourceHash: source.sourceHash,
      });
      const outputPath = await writeTranslatedContentAtomically({
        config,
        jobId: "job-output-read-failure",
        langCode: "ja-JP",
        markdown: sourceContent.replace("Body text.", "本文。"),
        memoryId,
      });
      const output = await import("node:fs/promises").then(({ readFile }) =>
        readFile(outputPath.absolutePath),
      );
      await connection.repositories.translations.updateTranslationJobStatus(
        "job-output-read-failure",
        "complete",
        {
          completedAt: now,
          outputHash: `sha256:${createHash("sha256").update(output).digest("hex")}`,
          outputPath: outputPath.relativePath,
          updatedAt: now,
        },
      );
      await rm(outputPath.absolutePath);
      await mkdir(outputPath.absolutePath, { recursive: true });

      await expect(
        resolveCurrentTranslationReadOnly({
          config,
          langCode: "ja-JP",
          memoryId,
          repository: connection.repositories.translations,
        }),
      ).rejects.toMatchObject({ code: "EISDIR" });
    } finally {
      connection.close();
    }
  });

  it("can resolve current translation state from an already loaded source snapshot", async () => {
    const config = await createConfig();
    const sourceContent = createMemoryContentFixture({
      frontmatter: {
        capturedAt: now.toISOString(),
        extractionStatus: "success",
        id: memoryId,
        title: "Brilliant Source",
        url: "https://example.com/brilliant",
      },
      markdown: "# Brilliant Source\n\nBody text.",
    });
    await writeSourceContent(config, sourceContent);
    const sourceSnapshot = await loadTranslationSourceSnapshot({ config, memoryId });
    await rm(join(config.storePath, "memories", memoryId, "CONTENT.md"));
    const connection = initializeDatabase(config);
    try {
      await expect(
        resolveCurrentTranslationReadOnly({
          config,
          langCode: "ja-JP",
          memoryId,
          repository: connection.repositories.translations,
          sourceSnapshot,
        }),
      ).resolves.toMatchObject({
        status: "missing",
        sourceHash: sourceSnapshot.sourceHash,
      });
    } finally {
      connection.close();
    }
  });

  it("does not treat completed output from an old translation policy as current", async () => {
    const config = await createConfig();
    const sourceContent = createMemoryContentFixture({
      frontmatter: {
        capturedAt: now.toISOString(),
        extractionStatus: "success",
        id: memoryId,
        title: "Brilliant Source",
        url: "https://example.com/brilliant",
      },
      markdown: "# Brilliant Source\n\nBody text.",
    });
    await writeSourceContent(config, sourceContent);
    const source = await loadTranslationSourceSnapshot({ config, memoryId });
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
        chunkCount: 1,
        chunkerVersion: BRILLIANT_CHUNKER_VERSION,
        jobId: "job-old-policy",
        langCode: "ja-JP",
        memoryId,
        model: "codex-test",
        now,
        promptPolicyVersion: "brilliant-v1",
        sourceHash: source.sourceHash,
      });
      const outputPath = await writeTranslatedContentAtomically({
        config,
        jobId: "job-old-policy",
        langCode: "ja-JP",
        markdown: sourceContent.replace("Body text.", "本文。"),
        memoryId,
      });
      const output = await import("node:fs/promises").then(({ readFile }) =>
        readFile(outputPath.absolutePath),
      );
      await connection.repositories.translations.updateTranslationJobStatus(
        "job-old-policy",
        "complete",
        {
          completedAt: now,
          outputHash: `sha256:${createHash("sha256").update(output).digest("hex")}`,
          outputPath: outputPath.relativePath,
          updatedAt: now,
        },
      );

      const current = await resolveCurrentTranslationReadOnly({
        config,
        langCode: "ja-JP",
        memoryId,
        repository: connection.repositories.translations,
      });

      expect(current).toMatchObject({
        reason: "policy_version_mismatch",
        status: "unavailable",
      });
      if (current.status === "unavailable") {
        await repairUnavailableTranslation({
          jobId: current.job.jobId,
          reason: current.reason,
          repository: connection.repositories.translations,
          now,
        });
      }
      expect(
        await connection.repositories.translations.getTranslationJob("job-old-policy"),
      ).toMatchObject({ status: "unavailable" });
    } finally {
      connection.close();
    }
  });
});

async function writeSourceContent(
  config: ResolvedTraumaConfig,
  content: string,
): Promise<void> {
  const filePath = join(config.storePath, "memories", memoryId, "CONTENT.md");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function createSourceContent(
  markdown = "# Brilliant Source\n\nBody text.",
): string {
  return createMemoryContentFixture({
    frontmatter: {
      capturedAt: now.toISOString(),
      extractionStatus: "success",
      id: memoryId,
      title: "Brilliant Source",
      url: "https://example.com/brilliant",
    },
    markdown,
  });
}

async function createConfig(): Promise<ResolvedTraumaConfig> {
  const root = await mkdtemp(join(tmpdir(), "trauma-translation-current-"));
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
