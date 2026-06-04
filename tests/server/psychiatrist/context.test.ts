import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPsychiatristMemoryContext,
  PsychiatristContextError,
} from "../../../src/server/psychiatrist/context";
import { createSha256ContentHash } from "../../../src/server/translation/hash";
import { resolveTranslatedMemoryContentPath } from "../../../src/server/translation/paths";
import {
  BRILLIANT_CHUNKER_VERSION,
  BRILLIANT_PROMPT_POLICY_VERSION,
} from "../../../src/server/translation/prompt";
import {
  createMemoryContentFixture,
  writeMemoryContent,
} from "../../../src/server/store";
import type {
  MemoryRepository,
  ReaderMemoryAggregateRow,
  TranslationJobRecord,
  TranslationRepository,
} from "../../../src/server/db/repositories";

const MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001";

describe("Psychiatrist memory context", () => {
  it("builds source memory context with metadata, hash, and markdown sections", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-context-"));
    const markdown = [
      "# Deploy Notes",
      "",
      "Main context.",
      "",
      "## Risks",
      "",
      "No rollback plan.",
    ].join("\n");
    await writeMemoryContent({
      config: { storePath },
      frontmatter: frontmatter({ title: "Deploy Notes" }),
      markdown,
      memoryId: MEMORY_ID,
    });

    const context = await buildPsychiatristMemoryContext({
      config: { storePath },
      memoryId: MEMORY_ID,
      memoryRepository: fakeMemoryRepository({
        categories: [{ id: "cat-1", name: "Ops" }],
        tags: [{ id: "tag-1", name: "deploy" }],
        title: "Deploy Notes",
      }),
      translationRepository: fakeTranslationRepository(),
    });

    expect(context).toMatchObject({
      categories: ["Ops"],
      contentHash: createSha256ContentHash(markdown),
      memoryId: MEMORY_ID,
      relativePath: `memories/${MEMORY_ID}/CONTENT.md`,
      sourceHash: createSha256ContentHash(markdown),
      sourceUrl: "https://example.com/source",
      tags: ["deploy"],
      title: "Deploy Notes",
      variantKind: "source",
    });
    expect(context.sections).toEqual([
      expect.objectContaining({
        anchor: "deploy-notes",
        level: 1,
        markdown: expect.stringContaining("# Deploy Notes"),
        path: "1",
        title: "Deploy Notes",
      }),
      expect.objectContaining({
        anchor: "risks",
        level: 2,
        markdown: expect.stringContaining("No rollback plan."),
        path: "1/1",
        title: "Risks",
      }),
    ]);
  });

  it("falls back to one document section when markdown has no headings", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-context-flat-"));
    await writeMemoryContent({
      config: { storePath },
      frontmatter: frontmatter({ title: "Flat" }),
      markdown: "A flat note without headings.",
      memoryId: MEMORY_ID,
    });

    const context = await buildPsychiatristMemoryContext({
      config: { storePath },
      memoryId: MEMORY_ID,
      memoryRepository: fakeMemoryRepository({ title: "Flat" }),
      translationRepository: fakeTranslationRepository(),
    });

    expect(context.sections).toEqual([
      expect.objectContaining({
        anchor: "document",
        level: 1,
        markdown: "A flat note without headings.",
        path: "document",
        title: "Document",
      }),
    ]);
  });

  it("preserves pre-heading memory text as an introduction section", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-context-pre-heading-"));
    const markdown = [
      "Important context before any heading.",
      "",
      "# Deploy Notes",
      "",
      "Main context.",
    ].join("\n");
    await writeMemoryContent({
      config: { storePath },
      frontmatter: frontmatter({ title: "Deploy Notes" }),
      markdown,
      memoryId: MEMORY_ID,
    });

    const context = await buildPsychiatristMemoryContext({
      config: { storePath },
      memoryId: MEMORY_ID,
      memoryRepository: fakeMemoryRepository({ title: "Deploy Notes" }),
      translationRepository: fakeTranslationRepository(),
    });

    expect(context.sections).toEqual([
      expect.objectContaining({
        anchor: "document-introduction",
        endOffset: markdown.indexOf("# Deploy Notes"),
        markdown: "Important context before any heading.",
        startOffset: 0,
        title: "Document introduction",
      }),
      expect.objectContaining({
        anchor: "deploy-notes",
        markdown: expect.stringContaining("# Deploy Notes"),
        title: "Deploy Notes",
      }),
    ]);
  });

  it("splits duplicate headings by occurrence instead of reusing the first offset", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-context-duplicate-"));
    const markdown = [
      "# Notes",
      "",
      "Intro.",
      "",
      "## Repeat",
      "",
      "First body.",
      "",
      "## Repeat",
      "",
      "Second body.",
    ].join("\n");
    await writeMemoryContent({
      config: { storePath },
      frontmatter: frontmatter({ title: "Notes" }),
      markdown,
      memoryId: MEMORY_ID,
    });

    const context = await buildPsychiatristMemoryContext({
      config: { storePath },
      memoryId: MEMORY_ID,
      memoryRepository: fakeMemoryRepository({ title: "Notes" }),
      translationRepository: fakeTranslationRepository(),
    });

    const repeated = context.sections.filter((section) => section.title === "Repeat");
    expect(repeated).toHaveLength(2);
    expect(repeated[0]?.markdown).toContain("First body.");
    expect(repeated[0]?.markdown).not.toContain("Second body.");
    expect(repeated[1]?.markdown).toContain("Second body.");
    expect(repeated[1]?.startOffset).toBeGreaterThan(repeated[0]?.startOffset ?? 0);
  });

  it("uses current translated CONTENT.md and output hash for translated context", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-context-ja-"));
    const sourceMarkdown = "# Source\n\nOriginal.";
    const translatedMarkdown = "# 翻訳\n\n翻訳本文。";
    const sourceContent = createMemoryContentFixture({
      frontmatter: frontmatter({ title: "Source" }),
      markdown: sourceMarkdown,
    });
    await writeMemoryContent({
      config: { storePath },
      frontmatter: frontmatter({ title: "Source" }),
      markdown: sourceMarkdown,
      memoryId: MEMORY_ID,
    });
    const translatedPath = resolveTranslatedMemoryContentPath({
      config: { storePath },
      langCode: "ja-JP",
      memoryId: MEMORY_ID,
    });
    await mkdir(join(storePath, "memories", MEMORY_ID, "ja-JP"), {
      recursive: true,
    });
    await writeFile(
      translatedPath.absolutePath,
      createMemoryContentFixture({
        frontmatter: frontmatter({ title: "翻訳" }),
        markdown: translatedMarkdown,
      }),
      "utf8",
    );
    const outputHash = createSha256ContentHash(
      createMemoryContentFixture({
        frontmatter: frontmatter({ title: "翻訳" }),
        markdown: translatedMarkdown,
      }),
    );
    const sourceHash = createSha256ContentHash(sourceContent);

    const context = await buildPsychiatristMemoryContext({
      config: { storePath },
      langCode: "ja-JP",
      memoryId: MEMORY_ID,
      memoryRepository: fakeMemoryRepository({ title: "Source" }),
      translationRepository: fakeTranslationRepository({
        outputHash,
        outputPath: translatedPath.relativePath,
        sourceHash,
      }),
    });

    expect(context).toMatchObject({
      contentHash: outputHash,
      langCode: "ja-JP",
      relativePath: translatedPath.relativePath,
      sourceHash,
      title: "Source",
      variantKind: "translation",
    });
    expect(context.sections[0]?.markdown).toContain("# 翻訳");
  });

  it("maps missing source memory to a typed missing_memory error", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-context-missing-"));

    await expect(
      buildPsychiatristMemoryContext({
        config: { storePath },
        memoryId: MEMORY_ID,
        memoryRepository: fakeMemoryRepository(undefined),
        translationRepository: fakeTranslationRepository(),
      }),
    ).rejects.toMatchObject({
      code: "missing_memory",
      name: "PsychiatristContextError",
    } satisfies Partial<PsychiatristContextError>);
  });

  it("maps stale translated content to context_unavailable", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-context-stale-"));
    await writeMemoryContent({
      config: { storePath },
      frontmatter: frontmatter({ title: "Source" }),
      markdown: "# Source",
      memoryId: MEMORY_ID,
    });

    await expect(
      buildPsychiatristMemoryContext({
        config: { storePath },
        langCode: "ja-JP",
        memoryId: MEMORY_ID,
        memoryRepository: fakeMemoryRepository({ title: "Source" }),
        translationRepository: fakeTranslationRepository(null),
      }),
    ).rejects.toMatchObject({
      code: "context_unavailable",
      name: "PsychiatristContextError",
    } satisfies Partial<PsychiatristContextError>);
  });
});

function frontmatter(input: { title: string }) {
  return {
    capturedAt: "2026-06-01T00:00:00.000Z",
    extractionStatus: "success" as const,
    id: MEMORY_ID,
    title: input.title,
    url: "https://example.com/source",
  };
}

function fakeMemoryRepository(
  input?: Partial<ReaderMemoryAggregateRow> & {
    categories?: Array<{ id: string; name: string }>;
    tags?: Array<{ id: string; name: string }>;
  },
): Pick<MemoryRepository, "findReaderAggregateById"> {
  return {
    async findReaderAggregateById() {
      if (input === undefined) {
        return undefined;
      }
      return {
        categories: [],
        contentPath: `memories/${MEMORY_ID}/CONTENT.md`,
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        description: null,
        extractionStatus: "success",
        faviconUrl: null,
        flashbacks: [],
        id: MEMORY_ID,
        memoryCategories: (input.categories ?? []).map((category) => ({ category })),
        memoryTags: (input.tags ?? []).map((tag) => ({ tag })),
        moments: [],
        read: false,
        tags: [],
        title: "Memory",
        updatedAt: new Date("2026-06-01T00:00:00.000Z"),
        url: "https://example.com/source",
        ...input,
      } as ReaderMemoryAggregateRow;
    },
  };
}

function fakeTranslationRepository(
  input?: Partial<TranslationJobRecord> | null,
): Pick<TranslationRepository, "findCompleteTranslationRecord"> {
  return {
    async findCompleteTranslationRecord() {
      if (input === null || input === undefined) {
        return null;
      }
      return {
        chunkCount: 1,
        chunkerVersion: BRILLIANT_CHUNKER_VERSION,
        completedAt: new Date("2026-06-01T00:00:00.000Z"),
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        error: null,
        jobId: "job-1",
        langCode: "ja-JP",
        memoryId: MEMORY_ID,
        model: null,
        outputHash: input.outputHash ?? "sha256:missing",
        outputPath: input.outputPath ?? `memories/${MEMORY_ID}/ja-JP/CONTENT.md`,
        promptPolicyVersion: BRILLIANT_PROMPT_POLICY_VERSION,
        reasoningEffort: null,
        sourceHash: input.sourceHash ?? "sha256:source",
        status: "complete",
        updatedAt: new Date("2026-06-01T00:00:00.000Z"),
        ...input,
      } as TranslationJobRecord;
    },
  };
}
