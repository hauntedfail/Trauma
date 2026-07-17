import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import * as legacyFlashbacksRoute from "../../../src/routes/api/flashbacks";
import { GET } from "../../../src/routes/api/flashbacks/page";
import { encodeCollectionCursor } from "../../../src/server/browse/collection-cursor";
import { initializeDatabase, schema } from "../../../src/server/db";
import { readCanonicalReaderText } from "../../../src/server/store/flashback-markers";
import {
  createReaderContentHash,
  writeMemoryContent,
} from "../../../src/server/store";
import {
  createApiEvent,
  loadRouteConfig,
  routeMemoryId,
  routeNow,
  seedRouteMemory,
  writeRouteConfig,
} from "./api-test-helpers";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("paged flashbacks API", () => {
  it("leaves the legacy mutation route without a GET export", () => {
    expect(legacyFlashbacksRoute).not.toHaveProperty("GET");
  });

  it("returns stable first and next envelopes without duplicates", async () => {
    const config = await seedFlashbacks();

    const firstResponse = await GET(eventFor("?page=1&limit=1"));
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    const firstCursor = first.nextCursor;
    expect(typeof firstCursor).toBe("string");
    expect(first).toMatchObject({
      flashbacks: [{ id: "flashback-b", memoryId: routeMemoryId }],
    });

    const secondResponse = await GET(
      eventFor(`?page=1&limit=1&cursor=${encodeURIComponent(firstCursor)}`),
    );
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json();
    expect(second).toMatchObject({
      flashbacks: [{ id: "flashback-a", memoryId: routeMemoryId }],
    });
    expect(second.flashbacks.map((row: { id: string }) => row.id)).not.toContain(
      first.flashbacks[0].id,
    );

    const connection = initializeDatabase(config);
    try {
      expect(
        await connection.repositories.flashbacks.listRecentForBrowse({
          cursor: null,
          limit: 1,
        }),
      ).toHaveLength(1);
    } finally {
      connection.close();
    }
  });

  it.each(["0", "101", "1.5", "NaN"])(
    "rejects invalid limit %s before collection work",
    async (limit) => {
      const response = await GET(eventFor(`?page=1&limit=${limit}`));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid limit" });
    },
  );

  it("rejects malformed and cross-collection cursors", async () => {
    const malformed = await GET(eventFor("?page=1&cursor=not-a-cursor"));
    const momentCursor = encodeCollectionCursor("moments", {
      createdAt: routeNow,
      id: "moment-1",
    });
    const mismatched = await GET(
      eventFor(`?page=1&cursor=${encodeURIComponent(momentCursor)}`),
    );

    expect(malformed.status).toBe(400);
    expect(mismatched.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: "invalid cursor" });
    await expect(mismatched.json()).resolves.toEqual({ error: "invalid cursor" });
  });
});

function eventFor(search: string) {
  return createApiEvent(
    new Request(`http://localhost/api/flashbacks/page${search}`),
  );
}

async function seedFlashbacks() {
  const root = await mkdtemp(join(tmpdir(), "trauma-flashbacks-page-route-"));
  tempDirs.push(root);
  const config = loadRouteConfig(await writeRouteConfig(root));
  await seedRouteMemory(config, { title: "Paged Flashbacks" });
  const markdown = "# Paged Flashbacks\n\nselected alpha and selected beta.";
  await writeMemoryContent({
    config,
    memoryId: routeMemoryId,
    frontmatter: {
      id: routeMemoryId,
      url: `https://example.com/${routeMemoryId}`,
      title: "Paged Flashbacks",
      capturedAt: routeNow.toISOString(),
      extractionStatus: "success",
    },
    markdown,
  });
  const canonical = readCanonicalReaderText(markdown);
  const contentHash = createReaderContentHash(markdown);
  const connection = initializeDatabase(config);
  try {
    await connection.db.insert(schema.flashbacks).values(
      ["a", "b"].map((suffix) => {
        const text = suffix === "a" ? "selected alpha" : "selected beta";
        const startOffset = canonical.indexOf(text);
        return {
          id: `flashback-${suffix}`,
          memoryId: routeMemoryId,
          text,
          prefix: "",
          suffix: "",
          startOffset,
          endOffset: startOffset + text.length,
          contentHash,
          createdAt: routeNow,
          updatedAt: routeNow,
        };
      }),
    );
  } finally {
    connection.close();
  }
  return config;
}
