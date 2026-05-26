import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GET,
  POST,
  parseMomentPayload,
} from "../../../src/routes/api/moments";
import { DELETE } from "../../../src/routes/api/moments/[momentId]";
import { initializeDatabase, schema } from "../../../src/server/db";
import {
  createMemoryContentFixture,
  createReaderContentHash,
} from "../../../src/server/store";
import { createSha256ContentHash } from "../../../src/server/translation/hash";
import {
  BRILLIANT_CHUNKER_VERSION,
  BRILLIANT_PROMPT_POLICY_VERSION,
} from "../../../src/server/translation/prompt";
import { resolveTranslatedMemoryContentPath } from "../../../src/server/translation/paths";
import {
  createApiEvent,
  loadRouteConfig,
  routeMemoryId,
  routeNow,
  seedRouteMemory,
  writeRouteConfig,
} from "./api-test-helpers";
import { writeMemoryContent } from "../../../src/server/store";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];
const momentRouteMarkdown = "# Route Memory\n\n## Chapter One\n\nSection body.";

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("moments API routes", () => {
  it("returns empty Moment fixtures without loading runtime config", async () => {
    const root = await makeRoot();
    process.env.TRAUMA_BROWSE_FIXTURES = "1";
    process.env.TRAUMA_CONFIG_PATH = join(root, "missing-trauma.config.json");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ moments: [] });
  });

  it("validates and normalizes a Moment section payload", async () => {
    await expect(
      parseMomentPayload(
        new Request("http://localhost/api/moments", {
          method: "POST",
          body: JSON.stringify({
            memoryId: ` ${routeMemoryId} `,
            sectionAnchor: " #chapter-one ",
            sectionTitle: " Chapter One ",
            sectionLevel: 2,
            sectionPath: "1/1",
            sectionStartOffset: null,
            sectionEndOffset: null,
            contentHash: "",
          }),
        }),
      ),
    ).resolves.toEqual({
      ok: true,
      memoryId: routeMemoryId,
      sectionAnchor: "chapter-one",
      sectionTitle: "Chapter One",
      sectionLevel: 2,
      sectionPath: "1/1",
      sectionStartOffset: null,
      sectionEndOffset: null,
      contentHash: null,
    });
  });

  it("accepts an optional translated reader language for Moment section resolution", async () => {
    await expect(
      parseMomentPayload(
        new Request("http://localhost/api/moments", {
          method: "POST",
          body: JSON.stringify({
            memoryId: routeMemoryId,
            langCode: "ja-JP",
            sectionAnchor: "translated-chapter",
            sectionTitle: "第一章",
            sectionLevel: 2,
            sectionPath: "1/1",
          }),
        }),
      ),
    ).resolves.toMatchObject({
      ok: true,
      langCode: "ja-JP",
      sectionAnchor: "translated-chapter",
      sectionTitle: "第一章",
    });
  });

  it("rejects malformed or over-posted Moment payloads", async () => {
    await expect(
      parseMomentPayload(
        new Request("http://localhost/api/moments", {
          method: "POST",
          body: JSON.stringify({
            memoryId: routeMemoryId,
            sectionAnchor: "chapter-one",
            sectionTitle: "Chapter One",
            sectionLevel: 2,
            sectionPath: "1/1",
            sectionStartOffset: 20,
            sectionEndOffset: 20,
            extra: true,
          }),
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      error:
        "request body must contain only memoryId, langCode, sectionAnchor, sectionTitle, sectionLevel, sectionPath, sectionStartOffset, sectionEndOffset, and contentHash",
    });
  });

  it("creates Moments idempotently, lists them with memory metadata, and deletes them", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config, { title: "Moment Route Memory" });
    await writeMomentContent(config);
    const expectedContentHash = createReaderContentHash(momentRouteMarkdown);

    const firstCreate = await POST(jsonRequest("POST", "/api/moments", {
      memoryId: routeMemoryId,
      sectionAnchor: "chapter-one",
      sectionTitle: "Chapter One",
      sectionLevel: 2,
      sectionPath: "1/1",
      sectionStartOffset: null,
      sectionEndOffset: null,
      contentHash: null,
    }));
    const firstBody = await firstCreate.json();
    const duplicateCreate = await POST(jsonRequest("POST", "/api/moments", {
      memoryId: routeMemoryId,
      sectionAnchor: "chapter-one",
      sectionTitle: "Chapter One",
      sectionLevel: 2,
      sectionPath: "1/1",
      sectionStartOffset: null,
      sectionEndOffset: null,
      contentHash: null,
    }));
    const duplicateBody = await duplicateCreate.json();
    const listResponse = await GET();
    const deleteResponse = await DELETE(
      createApiEvent(
        new Request(
          `http://localhost/api/moments/${firstBody.moment.id}`,
          { method: "DELETE" },
        ),
        { momentId: firstBody.moment.id },
      ),
    );

    expect(firstCreate.status).toBe(201);
    expect(firstBody).toMatchObject({
      alreadyExists: false,
      moment: {
        memoryId: routeMemoryId,
        sectionAnchor: "chapter-one",
        sectionTitle: "Chapter One",
        sectionLevel: 2,
        sectionPath: "1/1",
        contentHash: expectedContentHash,
      },
    });
    expect(duplicateCreate.status).toBe(200);
    expect(duplicateBody).toMatchObject({
      alreadyExists: true,
      moment: {
        id: firstBody.moment.id,
        memoryId: routeMemoryId,
      },
    });
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      moments: [
        {
          id: firstBody.moment.id,
          memoryId: routeMemoryId,
          memoryTitle: "Moment Route Memory",
          memoryUrl: `https://example.com/${routeMemoryId}`,
          sectionAnchor: "chapter-one",
          sectionTitle: "Chapter One",
          targetAnchor: "chapter-one",
          targetStatus: "current",
          contentHash: expectedContentHash,
        },
      ],
    });
    expect(deleteResponse.status).toBe(204);

    const connection = initializeDatabase(config);
    try {
      expect(
        connection.sqlite.prepare("select count(*) as count from moments").get(),
      ).toEqual({ count: 0 });
    } finally {
      connection.close();
    }
  });

  it("stores server-resolved Moment content hashes and rejects stale hash payloads", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config, { title: "Moment Route Memory" });
    await writeMomentContent(config);
    const expectedContentHash = createReaderContentHash(momentRouteMarkdown);

    const created = await POST(jsonRequest("POST", "/api/moments", {
      memoryId: routeMemoryId,
      sectionAnchor: "chapter-one",
      sectionTitle: "Chapter One",
      sectionLevel: 2,
      sectionPath: "1/1",
      sectionStartOffset: null,
      sectionEndOffset: null,
      contentHash: null,
    }));
    const stale = await POST(jsonRequest("POST", "/api/moments", {
      memoryId: routeMemoryId,
      sectionAnchor: "chapter-one",
      sectionTitle: "Chapter One",
      sectionLevel: 2,
      sectionPath: "1/1",
      sectionStartOffset: null,
      sectionEndOffset: null,
      contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }));
    const connection = initializeDatabase(config);
    try {
      expect(created.status).toBe(201);
      await expect(created.json()).resolves.toMatchObject({
        moment: {
          contentHash: expectedContentHash,
        },
      });
      expect(
        connection.sqlite
          .prepare("select content_hash as contentHash from moments")
          .get(),
      ).toEqual({ contentHash: expectedContentHash });
      expect(stale.status).toBe(400);
      await expect(stale.json()).resolves.toEqual({
        error: "moment content hash does not match reader content",
      });
    } finally {
      connection.close();
    }
  });

  it("lists Moments with resolved reader targets instead of raw stale anchors", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config, { title: "Moment Route Memory" });
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Moment Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\n## Renamed Chapter\n\nSection body.",
    });
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.moments.create({
        id: "moment-with-renamed-anchor",
        memoryId: routeMemoryId,
        sectionAnchor: "chapter-one",
        sectionTitle: "Chapter One",
        sectionLevel: 2,
        sectionPath: "1/1",
        sectionStartOffset: null,
        sectionEndOffset: null,
        contentHash: null,
        createdAt: routeNow,
        updatedAt: routeNow,
      });
    } finally {
      connection.close();
    }

    const listResponse = await GET();

    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      moments: [
        {
          id: "moment-with-renamed-anchor",
          memoryId: routeMemoryId,
          sectionAnchor: "chapter-one",
          targetAnchor: "renamed-chapter",
          targetStatus: "resolved_from_path",
        },
      ],
    });
  });

  it("does not treat a reused stale Moment anchor as current unless the path still matches", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config, { title: "Moment Route Memory" });
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Moment Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown:
        "# Route Memory\n\n## Original Anchor Reused Elsewhere\n\nDistractor.\n\n## Renamed Original Section\n\nSection body.",
    });
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.moments.create({
        id: "moment-with-reused-stale-anchor",
        memoryId: routeMemoryId,
        sectionAnchor: "original-anchor-reused-elsewhere",
        sectionTitle: "Original Section",
        sectionLevel: 2,
        sectionPath: "1/2",
        sectionStartOffset: null,
        sectionEndOffset: null,
        contentHash: null,
        createdAt: routeNow,
        updatedAt: routeNow,
      });
    } finally {
      connection.close();
    }

    const listResponse = await GET();

    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      moments: [
        {
          id: "moment-with-reused-stale-anchor",
          memoryId: routeMemoryId,
          sectionAnchor: "original-anchor-reused-elsewhere",
          targetAnchor: "renamed-original-section",
          targetStatus: "resolved_from_path",
        },
      ],
    });
  });

  it("falls back to the saved Moment path when a stale reader posts a reused anchor", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config, { title: "Moment Route Memory" });
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Moment Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown:
        "# Route Memory\n\n## Chapter One\n\nDistractor.\n\n## Target Section\n\nSection body.",
    });

    const response = await POST(jsonRequest("POST", "/api/moments", {
      memoryId: routeMemoryId,
      sectionAnchor: "chapter-one",
      sectionTitle: "Target Section",
      sectionLevel: 2,
      sectionPath: "1/2",
      sectionStartOffset: null,
      sectionEndOffset: null,
      contentHash: null,
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      moment: {
        memoryId: routeMemoryId,
        sectionAnchor: "target-section",
        sectionTitle: "Target Section",
        sectionPath: "1/2",
      },
    });
  });

  it("normalizes translated reader Moment sections to the source TOC section", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config, { title: "Moment Route Memory" });
    const sourceMarkdown = "# Route Memory\n\n## Chapter One\n\nSection body.";
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Moment Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: sourceMarkdown,
    });
    await writeTranslatedMomentContent({
      config,
      sourceMarkdown,
      translatedMarkdown: "# ルートメモリ\n\n## 第一章\n\n本文。",
    });

    const response = await POST(jsonRequest("POST", "/api/moments", {
      memoryId: routeMemoryId,
      langCode: "ja-JP",
      sectionAnchor: "第一章",
      sectionTitle: "第一章",
      sectionLevel: 2,
      sectionPath: "1/1",
      sectionStartOffset: null,
      sectionEndOffset: null,
      contentHash: null,
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      moment: {
        memoryId: routeMemoryId,
        sectionAnchor: "chapter-one",
        sectionTitle: "Chapter One",
        sectionPath: "1/1",
      },
    });
  });

  it("rejects Moments for missing or mismatched reader sections", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config, { title: "Moment Route Memory" });
    await writeMomentContent(config);

    const missing = await POST(jsonRequest("POST", "/api/moments", {
      memoryId: routeMemoryId,
      sectionAnchor: "missing-section",
      sectionTitle: "Missing Section",
      sectionLevel: 2,
      sectionPath: "1/2",
    }));
    const mismatched = await POST(jsonRequest("POST", "/api/moments", {
      memoryId: routeMemoryId,
      sectionAnchor: "chapter-one",
      sectionTitle: "Injected Title",
      sectionLevel: 2,
      sectionPath: "1/1",
    }));

    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: "moment section was not found",
    });
    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toEqual({
      error: "moment section identity does not match reader content",
    });
  });

  it("returns not found for missing memories and missing Moments", async () => {
    const root = await makeRoot();
    loadRouteConfig(await writeRouteConfig(root));

    const createResponse = await POST(jsonRequest("POST", "/api/moments", {
      memoryId: "missing-memory",
      sectionAnchor: "chapter-one",
      sectionTitle: "Chapter One",
      sectionLevel: 2,
      sectionPath: "1/1",
    }));
    const deleteResponse = await DELETE(
      createApiEvent(
        new Request("http://localhost/api/moments/missing", {
          method: "DELETE",
        }),
        { momentId: "missing" },
      ),
    );

    expect(createResponse.status).toBe(404);
    expect(await createResponse.json()).toEqual({ error: "memory was not found" });
    expect(deleteResponse.status).toBe(404);
    expect(await deleteResponse.json()).toEqual({
      error: "moment was not found",
    });
  });
});

function jsonRequest(method: "POST", path: string, body: unknown) {
  return createApiEvent(
    new Request(`http://localhost${path}`, {
      method,
      body: JSON.stringify(body),
    }),
  );
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-api-moments-"));
  tempDirs.push(root);
  return root;
}

async function writeMomentContent(
  config: ReturnType<typeof loadRouteConfig>,
): Promise<void> {
  await writeMemoryContent({
    config,
    memoryId: routeMemoryId,
    frontmatter: {
      id: routeMemoryId,
      url: `https://example.com/${routeMemoryId}`,
      title: "Moment Route Memory",
      capturedAt: routeNow.toISOString(),
      extractionStatus: "success",
    },
    markdown: momentRouteMarkdown,
  });
}

async function writeTranslatedMomentContent(input: {
  config: ReturnType<typeof loadRouteConfig>;
  sourceMarkdown: string;
  translatedMarkdown: string;
}): Promise<void> {
  const translatedPath = resolveTranslatedMemoryContentPath({
    config: input.config,
    langCode: "ja-JP",
    memoryId: routeMemoryId,
  });
  await mkdir(dirname(translatedPath.absolutePath), { recursive: true });
  await writeFile(
    translatedPath.absolutePath,
    createMemoryContentFixture({
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Moment Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: input.translatedMarkdown,
    }),
    "utf8",
  );
  const sourceHash = createSha256ContentHash(
    await readFile(join(input.config.storePath, "memories", routeMemoryId, "CONTENT.md")),
  );
  const outputHash = createSha256ContentHash(
    await readFile(translatedPath.absolutePath),
  );
  const connection = initializeDatabase(input.config);
  try {
    await connection.db.insert(schema.translationJobs).values({
      jobId: "019e3906-0000-7000-8000-000000000903",
      memoryId: routeMemoryId,
      langCode: "ja-JP",
      sourceHash,
      model: null,
      reasoningEffort: null,
      promptPolicyVersion: BRILLIANT_PROMPT_POLICY_VERSION,
      chunkerVersion: BRILLIANT_CHUNKER_VERSION,
      status: "complete",
      chunkCount: 1,
      outputPath: translatedPath.relativePath,
      outputHash,
      error: null,
      completedAt: routeNow,
      createdAt: routeNow,
      updatedAt: routeNow,
    });
  } finally {
    connection.close();
  }
}
