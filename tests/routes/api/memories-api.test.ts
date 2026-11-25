import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryPostHandler,
  GET as GET_MEMORIES,
} from "../../../src/routes/api/memories";
import {
  DELETE as DELETE_MEMORY,
  GET as GET_MEMORY,
} from "../../../src/routes/api/memories/[memoryId]";
import { initializeDatabase } from "../../../src/server/db";
import { TRAUMA_API_TOKEN_ENV_VAR } from "../../../src/server/http/api-auth";
import { upsertMemorySearchDocument } from "../../../src/server/search/fts";
import {
  createMemoryContentFixture,
  writeMemoryContent,
} from "../../../src/server/store/memory-content";
import {
  createApiEvent,
  loadRouteConfig,
  writeRouteConfig,
} from "../../server/routes/api-test-helpers";

const tempDirs: string[] = [];
const originalConfigPath = process.env.TRAUMA_CONFIG_PATH;
const originalApiToken = process.env[TRAUMA_API_TOKEN_ENV_VAR];

const MEMORY_ID_1 = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f401";
const MEMORY_ID_2 = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f402";
const MEMORY_ID_3 = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f403";
const MISSING_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f499";

afterEach(async () => {
  if (originalConfigPath === undefined) {
    delete process.env.TRAUMA_CONFIG_PATH;
  } else {
    process.env.TRAUMA_CONFIG_PATH = originalConfigPath;
  }
  if (originalApiToken === undefined) {
    delete process.env[TRAUMA_API_TOKEN_ENV_VAR];
  } else {
    process.env[TRAUMA_API_TOKEN_ENV_VAR] = originalApiToken;
  }

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function setupSeededWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "trauma-hermes-api-"));
  tempDirs.push(root);
  const configPath = await writeRouteConfig(root);
  const config = loadRouteConfig(configPath);
  const connection = initializeDatabase(config);

  const t1 = new Date("2026-05-10T10:00:00.000Z");
  const t2 = new Date("2026-05-11T10:00:00.000Z");
  const t3 = new Date("2026-05-12T10:00:00.000Z");

  try {
    await connection.repositories.memories.create({
      id: MEMORY_ID_1,
      url: "https://example.com/sqlite-fts5",
      title: "SQLite FTS5 Internals",
      description: "Deep dive into BM25 ranking and full-text search.",
      faviconUrl: "https://example.com/favicon.ico",
      contentPath: `memories/${MEMORY_ID_1}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      lastBackupAt: null,
      lastBackupError: null,
      read: true,
      createdAt: t1,
      updatedAt: t1,
    });
    await connection.repositories.memories.create({
      id: MEMORY_ID_2,
      url: "https://example.com/rust-async",
      title: "Rust Async Runtime Notes",
      description: "Tokio work-stealing scheduler notes.",
      faviconUrl: null,
      contentPath: `memories/${MEMORY_ID_2}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      lastBackupAt: null,
      lastBackupError: null,
      read: false,
      createdAt: t2,
      updatedAt: t2,
    });
    await connection.repositories.memories.create({
      id: MEMORY_ID_3,
      url: "https://example.com/sqlite-wal",
      title: "SQLite WAL Mode and Indexing",
      description: "Write-ahead logging and full-text indexing tricks.",
      faviconUrl: null,
      contentPath: `memories/${MEMORY_ID_3}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      lastBackupAt: null,
      lastBackupError: null,
      read: false,
      createdAt: t3,
      updatedAt: t3,
    });

    const tagSqlite = await connection.repositories.taxonomy.createTag({
      id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7a001",
      name: "sqlite",
      now: t1,
    });
    const tagRust = await connection.repositories.taxonomy.createTag({
      id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7a002",
      name: "rust",
      now: t2,
    });
    const catDatabases = await connection.repositories.taxonomy.createCategory({
      id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7b001",
      name: "Databases",
      now: t1,
    });
    const catSystems = await connection.repositories.taxonomy.createCategory({
      id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7b002",
      name: "Systems",
      now: t2,
    });

    await connection.repositories.taxonomy.attachTagToMemory({
      memoryId: MEMORY_ID_1,
      tagId: tagSqlite.id,
      now: t1,
    });
    await connection.repositories.taxonomy.attachTagToMemory({
      memoryId: MEMORY_ID_2,
      tagId: tagRust.id,
      now: t2,
    });
    await connection.repositories.taxonomy.attachTagToMemory({
      memoryId: MEMORY_ID_3,
      tagId: tagSqlite.id,
      now: t3,
    });

    await connection.repositories.taxonomy.attachCategoryToMemory({
      memoryId: MEMORY_ID_1,
      categoryId: catDatabases.id,
      now: t1,
    });
    await connection.repositories.taxonomy.attachCategoryToMemory({
      memoryId: MEMORY_ID_2,
      categoryId: catSystems.id,
      now: t2,
    });
    await connection.repositories.taxonomy.attachCategoryToMemory({
      memoryId: MEMORY_ID_3,
      categoryId: catDatabases.id,
      now: t3,
    });

    await connection.repositories.flashbacks.replaceForMemory(MEMORY_ID_1, [
      {
        id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7c001",
        memoryId: MEMORY_ID_1,
        variantKind: "source",
        langCode: null,
        translationOutputHash: null,
        text: "BM25 scores documents by term frequency",
        prefix: "In SQLite FTS5, ",
        suffix: " and inverse document frequency.",
        startOffset: 16,
        endOffset: 55,
        contentHash: "hash-1",
        createdAt: t1,
        updatedAt: t1,
      },
    ]);

    await connection.repositories.moments.create({
      id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7d001",
      memoryId: MEMORY_ID_1,
      sectionAnchor: "bm25-ranking",
      sectionTitle: "BM25 Ranking",
      sectionLevel: 2,
      sectionPath: "SQLite FTS5 Internals > BM25 Ranking",
      sectionStartOffset: 0,
      sectionEndOffset: 120,
      contentHash: "hash-1",
      createdAt: t1,
      updatedAt: t1,
    });

    const markdown1 =
      "# SQLite FTS5 Internals\n\n## BM25 Ranking\n\nIn SQLite FTS5, BM25 scores documents by term frequency and inverse document frequency.\n";
    await writeMemoryContent({
      config,
      memoryId: MEMORY_ID_1,
      frontmatter: {
        id: MEMORY_ID_1,
        url: "https://example.com/sqlite-fts5",
        title: "SQLite FTS5 Internals",
        capturedAt: t1.toISOString(),
        extractionStatus: "success",
      },
      markdown: markdown1,
    });

    const rawContent1 = createMemoryContentFixture({
      frontmatter: {
        id: MEMORY_ID_1,
        url: "https://example.com/sqlite-fts5",
        title: "SQLite FTS5 Internals",
        capturedAt: t1.toISOString(),
        extractionStatus: "success",
      },
      markdown: markdown1,
    });

    upsertMemorySearchDocument(connection.sqlite, {
      memoryId: MEMORY_ID_1,
      title: "SQLite FTS5 Internals",
      url: "https://example.com/sqlite-fts5",
      description: "Deep dive into BM25 ranking and full-text search.",
      bodyText:
        "SQLite FTS5 Internals BM25 Ranking In SQLite FTS5, BM25 scores documents by term frequency and inverse document frequency.",
    });
    upsertMemorySearchDocument(connection.sqlite, {
      memoryId: MEMORY_ID_2,
      title: "Rust Async Runtime Notes",
      url: "https://example.com/rust-async",
      description: "Tokio work-stealing scheduler notes.",
      bodyText: "Tokio work-stealing scheduler and async tasks in Rust.",
    });
    upsertMemorySearchDocument(connection.sqlite, {
      memoryId: MEMORY_ID_3,
      title: "SQLite WAL Mode and Indexing",
      url: "https://example.com/sqlite-wal",
      description: "Write-ahead logging and full-text indexing tricks.",
      bodyText:
        "SQLite WAL mode improves concurrent readers while FTS5 indexes stay fast.",
    });

    return {
      config,
      tagSqlite,
      tagRust,
      catDatabases,
      catSystems,
      rawContent1,
    };
  } finally {
    connection.close();
  }
}

describe("Hermes REST API: GET /api/memories", () => {
  it("supports cursor pagination, limit clamping, and invalid parameter errors", async () => {
    await setupSeededWorkspace();

    const page1Response = await GET_MEMORIES(
      createApiEvent(new Request("http://localhost/api/memories?limit=2")),
    );
    expect(page1Response.status).toBe(200);
    const page1 = (await page1Response.json()) as {
      items: Array<{ id: string; title: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(page1.items.map((item) => item.id)).toEqual([
      MEMORY_ID_3,
      MEMORY_ID_2,
    ]);
    expect(page1.hasMore).toBe(true);
    expect(typeof page1.nextCursor).toBe("string");

    const page2Response = await GET_MEMORIES(
      createApiEvent(
        new Request(
          `http://localhost/api/memories?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`,
        ),
      ),
    );
    expect(page2Response.status).toBe(200);
    const page2 = (await page2Response.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(page2.items.map((item) => item.id)).toEqual([MEMORY_ID_1]);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();

    // Clamps limit > 100 gracefully
    const largeLimitResponse = await GET_MEMORIES(
      createApiEvent(new Request("http://localhost/api/memories?limit=500")),
    );
    expect(largeLimitResponse.status).toBe(200);
    const largeLimitBody = (await largeLimitResponse.json()) as {
      items: unknown[];
      hasMore: boolean;
    };
    expect(largeLimitBody.items).toHaveLength(3);
    expect(largeLimitBody.hasMore).toBe(false);

    // Rejects invalid limit, read, and cursor
    expect(
      (
        await GET_MEMORIES(
          createApiEvent(new Request("http://localhost/api/memories?limit=0")),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET_MEMORIES(
          createApiEvent(new Request("http://localhost/api/memories?read=maybe")),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET_MEMORIES(
          createApiEvent(
            new Request("http://localhost/api/memories?cursor=not-valid!"),
          ),
        )
      ).status,
    ).toBe(400);
  });

  it("filters by tag, category, and read status", async () => {
    const { tagSqlite, catDatabases } = await setupSeededWorkspace();

    // Filter by tag name
    const byTagName = (await (
      await GET_MEMORIES(
        createApiEvent(new Request("http://localhost/api/memories?tag=sqlite")),
      )
    ).json()) as { items: Array<{ id: string }> };
    expect(byTagName.items.map((item) => item.id)).toEqual([
      MEMORY_ID_3,
      MEMORY_ID_1,
    ]);

    // Filter by tag ID
    const byTagId = (await (
      await GET_MEMORIES(
        createApiEvent(
          new Request(`http://localhost/api/memories?tag=${tagSqlite.id}`),
        ),
      )
    ).json()) as { items: Array<{ id: string }> };
    expect(byTagId.items.map((item) => item.id)).toEqual([
      MEMORY_ID_3,
      MEMORY_ID_1,
    ]);

    // Filter by category name and ID
    const byCatName = (await (
      await GET_MEMORIES(
        createApiEvent(
          new Request("http://localhost/api/memories?category=databases"),
        ),
      )
    ).json()) as { items: Array<{ id: string }> };
    expect(byCatName.items.map((item) => item.id)).toEqual([
      MEMORY_ID_3,
      MEMORY_ID_1,
    ]);

    const byCatId = (await (
      await GET_MEMORIES(
        createApiEvent(
          new Request(
            `http://localhost/api/memories?category=${catDatabases.id}`,
          ),
        ),
      )
    ).json()) as { items: Array<{ id: string }> };
    expect(byCatId.items.map((item) => item.id)).toEqual([
      MEMORY_ID_3,
      MEMORY_ID_1,
    ]);

    // Filter by read=true / read=read / read=false / read=unread / read=all
    const readTrue = (await (
      await GET_MEMORIES(
        createApiEvent(new Request("http://localhost/api/memories?read=true")),
      )
    ).json()) as { items: Array<{ id: string; read: boolean }> };
    expect(readTrue.items.map((item) => item.id)).toEqual([MEMORY_ID_1]);
    expect(readTrue.items[0]?.read).toBe(true);

    const readUnread = (await (
      await GET_MEMORIES(
        createApiEvent(
          new Request("http://localhost/api/memories?read=unread"),
        ),
      )
    ).json()) as { items: Array<{ id: string; read: boolean }> };
    expect(readUnread.items.map((item) => item.id)).toEqual([
      MEMORY_ID_3,
      MEMORY_ID_2,
    ]);

    const readFalse = (await (
      await GET_MEMORIES(
        createApiEvent(new Request("http://localhost/api/memories?read=false")),
      )
    ).json()) as { items: Array<{ id: string }> };
    expect(readFalse.items.map((item) => item.id)).toEqual([
      MEMORY_ID_3,
      MEMORY_ID_2,
    ]);
  });

  it("returns FTS5 match snippets, supports pagination, and combines q with filters", async () => {
    await setupSeededWorkspace();

    const page1Res = await GET_MEMORIES(
      createApiEvent(
        new Request("http://localhost/api/memories?q=SQLite&limit=1"),
      ),
    );
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as {
      items: Array<{ id: string; snippet?: string; rank?: number }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0]?.snippet).toContain("<mark>");
    expect(typeof page1.items[0]?.rank).toBe("number");
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2Res = await GET_MEMORIES(
      createApiEvent(
        new Request(
          `http://localhost/api/memories?q=SQLite&limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`,
        ),
      ),
    );
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as {
      items: Array<{ id: string; snippet?: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
    expect(page2.items[0]?.snippet).toContain("<mark>");
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();

    // Combine q with read=unread filter
    const filteredSearchRes = await GET_MEMORIES(
      createApiEvent(
        new Request("http://localhost/api/memories?q=SQLite&read=unread"),
      ),
    );
    expect(filteredSearchRes.status).toBe(200);
    const filteredSearch = (await filteredSearchRes.json()) as {
      items: Array<{ id: string; snippet?: string }>;
    };
    expect(filteredSearch.items.map((item) => item.id)).toEqual([MEMORY_ID_3]);
    expect(filteredSearch.items[0]?.snippet).toContain("<mark>");
  });
});

describe("Hermes REST API: GET /api/memories/:memoryId", () => {
  it("returns 200 with full memory metadata, raw CONTENT.md, tags, categories, flashbacks, and moments", async () => {
    const { rawContent1, tagSqlite, catDatabases } =
      await setupSeededWorkspace();

    const response = await GET_MEMORY(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID_1}`),
        { memoryId: MEMORY_ID_1 },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toMatchObject({
      id: MEMORY_ID_1,
      url: "https://example.com/sqlite-fts5",
      title: "SQLite FTS5 Internals",
      description: "Deep dive into BM25 ranking and full-text search.",
      faviconUrl: "https://example.com/favicon.ico",
      contentPath: `memories/${MEMORY_ID_1}/CONTENT.md`,
      extractionStatus: "success",
      backupStatus: "disabled",
      read: true,
      contentMarkdown: rawContent1,
      tags: [{ id: tagSqlite.id, name: "sqlite" }],
      categories: [{ id: catDatabases.id, name: "Databases" }],
    });

    expect(body.flashbacks).toEqual([
      expect.objectContaining({
        id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7c001",
        memoryId: MEMORY_ID_1,
        text: "BM25 scores documents by term frequency",
      }),
    ]);
    expect(body.moments).toEqual([
      expect.objectContaining({
        id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7d001",
        sectionAnchor: "bm25-ranking",
        sectionTitle: "BM25 Ranking",
      }),
    ]);
  });

  it("returns 404 when memory is not found", async () => {
    await setupSeededWorkspace();

    const response = await GET_MEMORY(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MISSING_MEMORY_ID}`),
        { memoryId: MISSING_MEMORY_ID },
      ),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "memory was not found",
    });
  });
});

describe("Hermes REST API: Bearer token auth across GET, POST, and DELETE", () => {
  it("allows valid Bearer token without Origin header, rejects invalid token with 401, and preserves CSRF without token", async () => {
    await setupSeededWorkspace();
    process.env[TRAUMA_API_TOKEN_ENV_VAR] = "hermes-api-secret-value";

    // GET /api/memories: valid token -> 200, invalid token -> 401, no token -> 200
    expect(
      (
        await GET_MEMORIES(
          createApiEvent(
            new Request("http://localhost/api/memories", {
              headers: { authorization: "Bearer hermes-api-secret-value" },
            }),
          ),
        )
      ).status,
    ).toBe(200);

    const invalidGetList = await GET_MEMORIES(
      createApiEvent(
        new Request("http://localhost/api/memories", {
          headers: { authorization: "Bearer wrong-secret" },
        }),
      ),
    );
    expect(invalidGetList.status).toBe(401);
    await expect(invalidGetList.json()).resolves.toEqual({
      error: "invalid API token",
    });

    // GET /api/memories/:memoryId: valid token -> 200, invalid token -> 401
    expect(
      (
        await GET_MEMORY(
          createApiEvent(
            new Request(`http://localhost/api/memories/${MEMORY_ID_1}`, {
              headers: { authorization: "Bearer hermes-api-secret-value" },
            }),
            { memoryId: MEMORY_ID_1 },
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await GET_MEMORY(
          createApiEvent(
            new Request(`http://localhost/api/memories/${MEMORY_ID_1}`, {
              headers: { authorization: "Bearer wrong-secret" },
            }),
            { memoryId: MEMORY_ID_1 },
          ),
        )
      ).status,
    ).toBe(401);

    // POST /api/memories: valid token succeeds without Origin header
    const postHandler = createMemoryPostHandler({
      createImporter: () => ({
        validateUrl: async (url) => new URL(url).toString(),
        importUrl: async ({ url }) => ({
          status: "success",
          url,
          title: "Imported via Hermes",
          description: "Headless API import",
          faviconUrl: null,
          markdown: "# Imported via Hermes\n\nBody text.\n",
        }),
      }),
    });

    const validPost = await postHandler(
      createApiEvent(
        new Request("http://localhost/api/memories", {
          method: "POST",
          headers: {
            authorization: "Bearer hermes-api-secret-value",
            "content-type": "application/json",
          },
          body: JSON.stringify({ url: "https://example.com/hermes-import" }),
        }),
      ),
    );
    expect(validPost.status).toBe(201);
    const createdBody = (await validPost.json()) as {
      memory: { id: string };
    };
    const createdId = createdBody.memory.id;

    // POST /api/memories: invalid token -> 401
    const invalidPost = await postHandler(
      createApiEvent(
        new Request("http://localhost/api/memories", {
          method: "POST",
          headers: {
            authorization: "Bearer bad-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ url: "https://example.com/blocked" }),
        }),
      ),
    );
    expect(invalidPost.status).toBe(401);

    // POST /api/memories: no token + cross-origin browser header -> 403 CSRF guard preserved
    const csrfBlockedPost = await postHandler(
      createApiEvent(
        new Request("http://localhost/api/memories", {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({ url: "https://example.com/csrf" }),
        }),
      ),
    );
    expect(csrfBlockedPost.status).toBe(403);

    // DELETE /api/memories/:memoryId: invalid token -> 401
    const invalidDelete = await DELETE_MEMORY(
      createApiEvent(
        new Request(`http://localhost/api/memories/${createdId}`, {
          method: "DELETE",
          headers: { authorization: "Bearer bad-token" },
        }),
        { memoryId: createdId },
      ),
    );
    expect(invalidDelete.status).toBe(401);

    // DELETE /api/memories/:memoryId: no token + cross-origin -> 403 CSRF guard preserved
    const csrfBlockedDelete = await DELETE_MEMORY(
      createApiEvent(
        new Request(`http://localhost/api/memories/${createdId}`, {
          method: "DELETE",
          headers: { origin: "https://evil.example" },
        }),
        { memoryId: createdId },
      ),
    );
    expect(csrfBlockedDelete.status).toBe(403);

    // DELETE /api/memories/:memoryId: valid token without Origin -> 204
    const validDelete = await DELETE_MEMORY(
      createApiEvent(
        new Request(`http://localhost/api/memories/${createdId}`, {
          method: "DELETE",
          headers: { authorization: "Bearer hermes-api-secret-value" },
        }),
        { memoryId: createdId },
      ),
    );
    expect(validDelete.status).toBe(204);
  });
});
