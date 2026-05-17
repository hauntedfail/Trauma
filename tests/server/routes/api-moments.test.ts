import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GET,
  POST,
  parseMomentPayload,
} from "../../../src/routes/api/moments";
import { DELETE } from "../../../src/routes/api/moments/[momentId]";
import { initializeDatabase } from "../../../src/server/db";
import { createReaderContentHash } from "../../../src/server/store";
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
        "request body must contain only memoryId, sectionAnchor, sectionTitle, sectionLevel, sectionPath, sectionStartOffset, sectionEndOffset, and contentHash",
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
