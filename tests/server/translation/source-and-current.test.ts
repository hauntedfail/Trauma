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
  resolveCurrentTranslationReadOnly,
} from "../../../src/server/translation/current-translation";
import {
  BRILLIANT_CHUNKER_VERSION,
  BRILLIANT_PROMPT_POLICY_VERSION,
} from "../../../src/server/translation/prompt";
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
