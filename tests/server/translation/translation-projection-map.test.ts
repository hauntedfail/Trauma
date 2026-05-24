import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { resolveTranslatedMemoryProjectionPath } from "../../../src/server/translation/paths";
import { serializeTranslationProjectionSidecar } from "../../../src/server/translation/projection-map";
import type { TranslationProjectionSpan } from "../../../src/server/translation/types";

const tempRoots: string[] = [];
const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f901";
const now = new Date("2026-05-23T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("translation projection map", () => {
  it("resolves the translated projection sidecar beside translated CONTENT.md", async () => {
    const config = await createConfig();

    expect(
      resolveTranslatedMemoryProjectionPath({
        config,
        langCode: "ja-JP",
        memoryId,
      }),
    ).toEqual({
      absolutePath: join(
        config.storePath,
        "memories",
        memoryId,
        "ja-JP",
        "TRANSLATION_MAP.json",
      ),
      relativePath: `memories/${memoryId}/ja-JP/TRANSLATION_MAP.json`,
    });
  });

  it("serializes projection sidecars in stable span order", () => {
    const serialized = serializeTranslationProjectionSidecar({
      jobId: "job-projection",
      langCode: "ja-JP",
      memoryId,
      outputHash: "sha256:output",
      sourceHash: "sha256:source",
      spans: [
        createSpan({ spanIndex: 1, segmentId: "s000002" }),
        createSpan({ spanIndex: 0, segmentId: "s000001" }),
      ],
      version: 1,
    });

    expect(JSON.parse(serialized)).toMatchObject({
      jobId: "job-projection",
      spans: [
        { segmentId: "s000001", spanIndex: 0 },
        { segmentId: "s000002", spanIndex: 1 },
      ],
      version: 1,
    });
    expect(serialized.endsWith("\n")).toBe(true);
  });
});

function createSpan(input: {
  segmentId: string;
  spanIndex: number;
}): TranslationProjectionSpan {
  const offset = input.spanIndex * 10;
  return {
    blockId: "b000001",
    createdAt: now,
    jobId: "job-projection",
    langCode: "ja-JP",
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
  const root = await mkdtemp(join(tmpdir(), "trauma-translation-projection-"));
  tempRoots.push(root);
  return {
    backup: {
      git: {
        branch: "main",
        commitMessageTemplate: "backup {action} {memoryId}",
        enabled: false,
        push: false,
        remote: "origin",
      },
    },
    configFilePath: join(root, "trauma.config.json"),
    databasePath: join(root, ".trauma/trauma.sqlite"),
    projectPath: join(root, "data"),
    storePath: join(root, "data/storage"),
  };
}
