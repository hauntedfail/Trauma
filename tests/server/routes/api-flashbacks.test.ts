import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GET,
  POST,
  parseFlashbackPayload,
} from "../../../src/routes/api/flashbacks";
import { DELETE } from "../../../src/routes/api/flashbacks/[flashbackId]";
import { initializeDatabase } from "../../../src/server/db";
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

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("flashbacks API routes", () => {
  it("validates and normalizes a Flashback section payload", async () => {
    await expect(
      parseFlashbackPayload(
        new Request("http://localhost/api/flashbacks", {
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

  it("rejects malformed or over-posted Flashback payloads", async () => {
    await expect(
      parseFlashbackPayload(
        new Request("http://localhost/api/flashbacks", {
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
        "request body must contain only memoryId, sectionAnchor, sectionTitle, sectionLevel, sectionPath, sectionStartOffset, sectionEndOffset, and contentHash",
    });
  });

  it("creates Flashbacks idempotently, lists them with memory metadata, and deletes them", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config, { title: "Flashback Route Memory" });
    await writeFlashbackContent(config);

    const firstCreate = await POST(jsonRequest("POST", "/api/flashbacks", {
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
    const duplicateCreate = await POST(jsonRequest("POST", "/api/flashbacks", {
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
          `http://localhost/api/flashbacks/${firstBody.flashback.id}`,
          { method: "DELETE" },
        ),
        { flashbackId: firstBody.flashback.id },
      ),
    );

    expect(firstCreate.status).toBe(201);
    expect(firstBody).toMatchObject({
      alreadyExists: false,
      flashback: {
        memoryId: routeMemoryId,
        sectionAnchor: "chapter-one",
        sectionTitle: "Chapter One",
        sectionLevel: 2,
        sectionPath: "1/1",
      },
    });
    expect(duplicateCreate.status).toBe(200);
    expect(duplicateBody).toMatchObject({
      alreadyExists: true,
      flashback: {
        id: firstBody.flashback.id,
        memoryId: routeMemoryId,
      },
    });
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      flashbacks: [
        {
          id: firstBody.flashback.id,
          memoryId: routeMemoryId,
          memoryTitle: "Flashback Route Memory",
          memoryUrl: `https://example.com/${routeMemoryId}`,
          sectionAnchor: "chapter-one",
          sectionTitle: "Chapter One",
        },
      ],
    });
    expect(deleteResponse.status).toBe(204);

    const connection = initializeDatabase(config);
    try {
      expect(
        connection.sqlite.prepare("select count(*) as count from flashbacks").get(),
      ).toEqual({ count: 0 });
    } finally {
      connection.close();
    }
  });

  it("rejects Flashbacks for missing or mismatched reader sections", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config, { title: "Flashback Route Memory" });
    await writeFlashbackContent(config);

    const missing = await POST(jsonRequest("POST", "/api/flashbacks", {
      memoryId: routeMemoryId,
      sectionAnchor: "missing-section",
      sectionTitle: "Missing Section",
      sectionLevel: 2,
      sectionPath: "1/2",
    }));
    const mismatched = await POST(jsonRequest("POST", "/api/flashbacks", {
      memoryId: routeMemoryId,
      sectionAnchor: "chapter-one",
      sectionTitle: "Injected Title",
      sectionLevel: 2,
      sectionPath: "1/1",
    }));

    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: "flashback section was not found",
    });
    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toEqual({
      error: "flashback section identity does not match reader content",
    });
  });

  it("returns not found for missing memories and missing Flashbacks", async () => {
    const root = await makeRoot();
    loadRouteConfig(await writeRouteConfig(root));

    const createResponse = await POST(jsonRequest("POST", "/api/flashbacks", {
      memoryId: "missing-memory",
      sectionAnchor: "chapter-one",
      sectionTitle: "Chapter One",
      sectionLevel: 2,
      sectionPath: "1/1",
    }));
    const deleteResponse = await DELETE(
      createApiEvent(
        new Request("http://localhost/api/flashbacks/missing", {
          method: "DELETE",
        }),
        { flashbackId: "missing" },
      ),
    );

    expect(createResponse.status).toBe(404);
    expect(await createResponse.json()).toEqual({ error: "memory was not found" });
    expect(deleteResponse.status).toBe(404);
    expect(await deleteResponse.json()).toEqual({
      error: "flashback was not found",
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
  const root = await mkdtemp(join(tmpdir(), "trauma-api-flashbacks-"));
  tempDirs.push(root);
  return root;
}

async function writeFlashbackContent(
  config: ReturnType<typeof loadRouteConfig>,
): Promise<void> {
  await writeMemoryContent({
    config,
    memoryId: routeMemoryId,
    frontmatter: {
      id: routeMemoryId,
      url: `https://example.com/${routeMemoryId}`,
      title: "Flashback Route Memory",
      capturedAt: routeNow.toISOString(),
      extractionStatus: "success",
    },
    markdown: "# Route Memory\n\n## Chapter One\n\nSection body.",
  });
}
