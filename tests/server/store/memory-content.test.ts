import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  MEMORY_CONTENT_FILENAME,
  createMemoryContentFixture,
  readMemoryContent,
  resolveMemoryContentPath,
  writeMemoryContent,
} from "../../../src/server/store/memory-content";

const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef111";

const tempDirs: string[] = [];

async function makeStorePath() {
  const storePath = await mkdtemp(join(tmpdir(), "trauma-store-"));
  tempDirs.push(storePath);
  return storePath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("memory content path resolution", () => {
  it("resolves CONTENT.md under memories/{memoryId}", async () => {
    const storePath = await makeStorePath();

    const resolved = resolveMemoryContentPath({ storePath }, memoryId);

    expect(resolved.relativePath).toBe(`memories/${memoryId}/CONTENT.md`);
    expect(resolved.absolutePath).toBe(
      join(storePath, "memories", memoryId, MEMORY_CONTENT_FILENAME),
    );
  });

  it("rejects memory IDs that cannot be a UUID v7 path segment", async () => {
    const storePath = await makeStorePath();

    expect(() => resolveMemoryContentPath({ storePath }, "../escape")).toThrow(
      /UUID v7/,
    );
  });
});

describe("memory content writing and reading", () => {
  it("writes the content contract and reads frontmatter plus markdown body", async () => {
    const storePath = await makeStorePath();
    const markdown =
      "# Example Memory\n\nSaved content with [remote image](https://example.com/image.png).";

    const result = await writeMemoryContent({
      config: { storePath },
      memoryId,
      frontmatter: {
        id: memoryId,
        url: "https://example.com/article",
        title: 'Title with "quotes" and: colon',
        capturedAt: "2026-05-09T06:00:00.000Z",
        extractionStatus: "extracted",
      },
      markdown,
    });

    expect(result.relativePath).toBe(`memories/${memoryId}/CONTENT.md`);

    const file = await readFile(result.absolutePath, "utf8");
    expect(file).toBe(
      [
        "---",
        `id: ${JSON.stringify(memoryId)}`,
        'url: "https://example.com/article"',
        'title: "Title with \\"quotes\\" and: colon"',
        'captured_at: "2026-05-09T06:00:00.000Z"',
        'extraction_status: "extracted"',
        "---",
        markdown,
      ].join("\n"),
    );
    expect(file).not.toContain("tags:");
    expect(file).not.toContain("categories:");

    const read = await readMemoryContent({
      config: { storePath },
      memoryId,
    });

    expect(read.relativePath).toBe(result.relativePath);
    expect(read.frontmatter).toEqual({
      id: memoryId,
      url: "https://example.com/article",
      title: 'Title with "quotes" and: colon',
      capturedAt: "2026-05-09T06:00:00.000Z",
      extractionStatus: "extracted",
    });
    expect(read.markdown).toBe(markdown);
  });

  it("preserves remote image markdown without downloading or rewriting links", async () => {
    const storePath = await makeStorePath();
    const markdown =
      "![remote alt](https://cdn.example.test/asset.png)\n\n<img src=\"https://cdn.example.test/raw.jpg\" />";

    await writeMemoryContent({
      config: { storePath },
      memoryId,
      frontmatter: {
        id: memoryId,
        url: "https://example.com/remote-images",
        title: "Remote images stay remote",
        capturedAt: "2026-05-09T06:00:00.000Z",
        extractionStatus: "extracted",
      },
      markdown,
    });

    const read = await readMemoryContent({ config: { storePath }, memoryId });

    expect(read.markdown).toBe(markdown);
    expect(read.markdown).toContain("https://cdn.example.test/asset.png");
    expect(read.markdown).toContain("https://cdn.example.test/raw.jpg");
  });

  it("creates deterministic fixture markdown for tests and docs", () => {
    const fixture = createMemoryContentFixture({
      frontmatter: {
        id: memoryId,
        url: "https://example.com/fixture",
        title: "Fixture",
        capturedAt: "2026-05-09T06:00:00.000Z",
        extractionStatus: "link_only",
      },
      markdown: "A fixture body.",
    });

    expect(fixture).toBe(
      [
        "---",
        `id: ${JSON.stringify(memoryId)}`,
        'url: "https://example.com/fixture"',
        'title: "Fixture"',
        'captured_at: "2026-05-09T06:00:00.000Z"',
        'extraction_status: "link_only"',
        "---",
        "A fixture body.",
      ].join("\n"),
    );
  });
});

describe("memory content read failures", () => {
  it("fails clearly when CONTENT.md is missing", async () => {
    const storePath = await makeStorePath();

    await expect(readMemoryContent({ config: { storePath }, memoryId })).rejects
      .toThrow(/CONTENT\.md is missing/);
  });

  it("fails clearly when CONTENT.md frontmatter is malformed", async () => {
    const storePath = await makeStorePath();
    const { absolutePath } = resolveMemoryContentPath({ storePath }, memoryId);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "---\nid: nope\n---\nbody\n", "utf8");

    await expect(readMemoryContent({ config: { storePath }, memoryId })).rejects
      .toThrow(/malformed frontmatter/);
  });

  it("keeps generated files inside the temp store path", async () => {
    const storePath = await makeStorePath();

    const written = await writeMemoryContent({
      config: { storePath },
      memoryId,
      frontmatter: {
        id: memoryId,
        url: "https://example.com/locality",
        title: "Locality",
        capturedAt: "2026-05-09T06:00:00.000Z",
        extractionStatus: "extracted",
      },
      markdown: "Locality check.",
    });

    expect(relative(storePath, written.absolutePath)).toBe(
      `memories/${memoryId}/CONTENT.md`,
    );
  });
});
