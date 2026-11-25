import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryPostHandler } from "../../../src/routes/api/memories";
import { POST as POST_POSITION } from "../../../src/routes/api/memories/[memoryId]/position";
import { POST as POST_TRIAGE } from "../../../src/routes/api/memories/[memoryId]/triage";
import { initializeDatabase } from "../../../src/server/db";
import { TRAUMA_API_TOKEN_ENV_VAR } from "../../../src/server/http/api-auth";
import { loadReaderMemory } from "../../../src/server/reader/page-data";
import { writeMemoryContent } from "../../../src/server/store/memory-content";
import {
  createApiEvent,
  loadRouteConfig,
  writeRouteConfig,
} from "../../server/routes/api-test-helpers";

const tempDirs: string[] = [];
const originalConfigPath = process.env.TRAUMA_CONFIG_PATH;
const originalApiToken = process.env[TRAUMA_API_TOKEN_ENV_VAR];

const MEMORY_ID_1 = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f501";
const MEMORY_ID_2 = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f502";
const MISSING_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f599";

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

async function setupWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "trauma-triage-position-api-"));
  tempDirs.push(root);
  const configPath = await writeRouteConfig(root);
  process.env.TRAUMA_CONFIG_PATH = configPath;
  const config = loadRouteConfig(configPath);
  const connection = initializeDatabase(config);
  const t1 = new Date("2026-05-10T10:00:00.000Z");
  const t2 = new Date("2026-05-11T10:00:00.000Z");

  try {
    await connection.repositories.memories.create({
      id: MEMORY_ID_1,
      url: "https://example.com/article-one",
      title: "Article One",
      description: "First article",
      faviconUrl: null,
      contentPath: `memories/${MEMORY_ID_1}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      triageState: "shelf",
      triageChangedAt: t1,
      wordCount: 850,
      createdAt: t1,
      updatedAt: t1,
    });
    await connection.repositories.memories.create({
      id: MEMORY_ID_2,
      url: "https://example.com/article-two",
      title: "Article Two",
      description: "Second article",
      faviconUrl: null,
      contentPath: `memories/${MEMORY_ID_2}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      triageState: "shelf",
      triageChangedAt: t2,
      wordCount: 1600,
      createdAt: t2,
      updatedAt: t2,
    });

    await writeMemoryContent({
      config: { storePath: config.storePath },
      memoryId: MEMORY_ID_1,
      overwrite: true,
      frontmatter: {
        id: MEMORY_ID_1,
        url: "https://example.com/article-one",
        title: "Article One",
        capturedAt: t1.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Article One\n\nFirst paragraph of body text.\n",
    });
  } finally {
    connection.close();
  }

  return { config, configPath, root };
}

describe("POST /api/memories capture defaults, triage, and position routes", () => {
  it("creates new captures on shelf with non-null triage_changed_at and word_count", async () => {
    const { config } = await setupWorkspace();
    const postMemory = createMemoryPostHandler({
      createImporter: () => ({
        validateUrl: async (url) => url,
        importUrl: async ({ url }) => ({
          status: "success",
          url,
          title: "Captured Focus Note",
          description: "Summary",
          faviconUrl: null,
          markdown: "# Heading\n\nOne two three four five six.\n",
        }),
      }),
    });

    const response = await postMemory(
      createApiEvent(
        new Request("http://localhost/api/memories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "https://example.com/focus-note" }),
        }),
      ),
    );

    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      memory: {
        id: string;
        triageState: string;
        triageChangedAt: string;
        wordCount: number | null;
      };
    };
    expect(created.memory.triageState).toBe("shelf");
    expect(created.memory.wordCount).toBe(7);

    const connection = initializeDatabase(config);
    try {
      const stored = await connection.repositories.memories.findById(
        created.memory.id,
      );
      expect(stored?.triageState).toBe("shelf");
      expect(stored?.triageChangedAt).toBeInstanceOf(Date);
      expect(stored?.triageChangedAt.getTime()).toBeGreaterThan(0);
      expect(stored?.wordCount).toBe(7);
    } finally {
      connection.close();
    }
  });

  it("performs idempotent triage transitions and enforces todayCap with 409", async () => {
    const { config } = await setupWorkspace();

    // Move MEMORY_ID_1 to today with todayCap=1
    const firstMove = await POST_TRIAGE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID_1}/triage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ triage_state: "today", todayCap: 1 }),
        }),
        { memoryId: MEMORY_ID_1 },
      ),
    );
    expect(firstMove.status).toBe(200);
    const firstBody = (await firstMove.json()) as {
      memoryId: string;
      triageState: string;
      triageChangedAt: string;
      changed: boolean;
    };
    expect(firstBody.memoryId).toBe(MEMORY_ID_1);
    expect(firstBody.triageState).toBe("today");
    expect(firstBody.changed).toBe(true);

    // Repeating same state is idempotent and does not trip todayCap
    const repeatMove = await POST_TRIAGE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID_1}/triage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ triage_state: "today", todayCap: 1 }),
        }),
        { memoryId: MEMORY_ID_1 },
      ),
    );
    expect(repeatMove.status).toBe(200);
    const repeatBody = (await repeatMove.json()) as {
      triageChangedAt: string;
      changed: boolean;
    };
    expect(repeatBody.changed).toBe(false);
    expect(repeatBody.triageChangedAt).toBe(firstBody.triageChangedAt);

    // Moving MEMORY_ID_2 to today while cap=1 is reached returns 409
    const capRejected = await POST_TRIAGE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID_2}/triage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ triage_state: "today", todayCap: 1 }),
        }),
        { memoryId: MEMORY_ID_2 },
      ),
    );
    expect(capRejected.status).toBe(409);
    const capBody = (await capRejected.json()) as {
      code: string;
      todayCap: number;
      todayCount: number;
    };
    expect(capBody).toMatchObject({
      code: "today_cap_reached",
      todayCap: 1,
      todayCount: 1,
    });

    // Transition MEMORY_ID_1 to library, then archive
    const toLibrary = await POST_TRIAGE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID_1}/triage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ triage_state: "library" }),
        }),
        { memoryId: MEMORY_ID_1 },
      ),
    );
    expect(toLibrary.status).toBe(200);

    const toArchive = await POST_TRIAGE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID_1}/triage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ triage_state: "archive" }),
        }),
        { memoryId: MEMORY_ID_1 },
      ),
    );
    expect(toArchive.status).toBe(200);

    const connection = initializeDatabase(config);
    try {
      const stored = await connection.repositories.memories.findById(MEMORY_ID_1);
      expect(stored?.triageState).toBe("archive");
    } finally {
      connection.close();
    }
  });

  it("rejects invalid triage_state with 400, unknown IDs with 404, and enforces auth/CSRF guards", async () => {
    await setupWorkspace();
    process.env[TRAUMA_API_TOKEN_ENV_VAR] = "secret-token";

    const invalidState = await POST_TRIAGE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID_1}/triage`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer secret-token",
          },
          body: JSON.stringify({ triage_state: "inbox" }),
        }),
        { memoryId: MEMORY_ID_1 },
      ),
    );
    expect(invalidState.status).toBe(400);

    const unknownMemory = await POST_TRIAGE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MISSING_MEMORY_ID}/triage`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer secret-token",
          },
          body: JSON.stringify({ triage_state: "library" }),
        }),
        { memoryId: MISSING_MEMORY_ID },
      ),
    );
    expect(unknownMemory.status).toBe(404);

    const badToken = await POST_TRIAGE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID_1}/triage`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer wrong-token",
          },
          body: JSON.stringify({ triage_state: "library" }),
        }),
        { memoryId: MEMORY_ID_1 },
      ),
    );
    expect(badToken.status).toBe(401);

    const crossOrigin = await POST_TRIAGE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID_1}/triage`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example",
          },
          body: JSON.stringify({ triage_state: "library" }),
        }),
        { memoryId: MEMORY_ID_1 },
      ),
    );
    expect(crossOrigin.status).toBe(403);
  });

  it("persists last_position and last_opened_at and exposes them on reader payload", async () => {
    const { config } = await setupWorkspace();
    const payload = {
      variant: "source",
      headingId: "section-4",
      paragraphIndex: 12,
      scrollRatio: 0.65,
      updatedAt: "2026-05-12T08:30:00.000Z",
    };

    const response = await POST_POSITION(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID_1}/position`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        { memoryId: MEMORY_ID_1 },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      memoryId: MEMORY_ID_1,
      lastPosition: payload,
      lastOpenedAt: "2026-05-12T08:30:00.000Z",
    });

    const readerResult = await loadReaderMemory(MEMORY_ID_1, { config });
    expect(readerResult.status).toBe("ready");
    if (readerResult.status === "ready") {
      expect(readerResult.memory.triageState).toBe("shelf");
      expect(readerResult.memory.lastPosition).toEqual(payload);
      expect(readerResult.memory.lastOpenedAt?.toISOString()).toBe(
        "2026-05-12T08:30:00.000Z",
      );
      expect(readerResult.memory.wordCount).toBe(850);
    }
  });

  it("rejects malformed position payloads with 400 and unknown memory IDs with 404", async () => {
    await setupWorkspace();

    const malformedPayloads = [
      { variant: "source", paragraphIndex: 1, scrollRatio: 0.5, updatedAt: "2026-05-12T08:30:00.000Z" },
      { variant: "source", headingId: "h1", paragraphIndex: -1, scrollRatio: 0.5, updatedAt: "2026-05-12T08:30:00.000Z" },
      { variant: "source", headingId: "h1", paragraphIndex: 1.5, scrollRatio: 0.5, updatedAt: "2026-05-12T08:30:00.000Z" },
      { variant: "source", headingId: "h1", paragraphIndex: 1, scrollRatio: 1.5, updatedAt: "2026-05-12T08:30:00.000Z" },
      { variant: "source", headingId: "h1", paragraphIndex: 1, scrollRatio: 0.5, updatedAt: "not-a-date" },
      { variant: "source", headingId: "h1", paragraphIndex: 1, scrollRatio: 0.5, updatedAt: "2026-05-12T08:30:00.000Z", extra: true },
    ];

    for (const body of malformedPayloads) {
      const response = await POST_POSITION(
        createApiEvent(
          new Request(`http://localhost/api/memories/${MEMORY_ID_1}/position`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          { memoryId: MEMORY_ID_1 },
        ),
      );
      expect(response.status).toBe(400);
    }

    const notFound = await POST_POSITION(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MISSING_MEMORY_ID}/position`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            variant: "source",
            headingId: null,
            paragraphIndex: 0,
            scrollRatio: 0,
            updatedAt: "2026-05-12T08:30:00.000Z",
          }),
        }),
        { memoryId: MISSING_MEMORY_ID },
      ),
    );
    expect(notFound.status).toBe(404);
  });

  it("records last_opened_at via openOnly without overwriting saved last_position", async () => {
    const { config } = await setupWorkspace();

    const openResponse = await POST_POSITION(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID_1}/position`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ openOnly: true }),
        }),
        { memoryId: MEMORY_ID_1 },
      ),
    );
    expect(openResponse.status).toBe(200);
    const openJson = (await openResponse.json()) as {
      memoryId: string;
      lastOpenedAt: string | null;
    };
    expect(openJson.memoryId).toBe(MEMORY_ID_1);
    expect(openJson.lastOpenedAt).not.toBeNull();

    const readerResult = await loadReaderMemory(MEMORY_ID_1, { config });
    expect(readerResult.status).toBe("ready");
    if (readerResult.status === "ready") {
      expect(readerResult.memory.lastOpenedAt).not.toBeNull();
      expect(readerResult.memory.lastPosition).toBeNull();
    }
  });
});
