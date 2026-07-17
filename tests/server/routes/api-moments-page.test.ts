import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET } from "../../../src/routes/api/moments";
import { encodeCollectionCursor } from "../../../src/server/browse/collection-cursor";
import { initializeDatabase } from "../../../src/server/db";
import { writeMemoryContent } from "../../../src/server/store";
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

describe("paged moments API", () => {
  it("keeps no-query GET on the legacy full-list envelope", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-moments-legacy-route-"));
    tempDirs.push(root);
    process.env.TRAUMA_BROWSE_FIXTURES = "1";
    process.env.TRAUMA_CONFIG_PATH = join(root, "missing-trauma.config.json");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ moments: [] });
  });

  it("returns stable first and next envelopes only in explicit page mode", async () => {
    await seedMoments();

    const firstResponse = await GET(eventFor("?page=1&limit=1"));
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    const firstCursor = first.nextCursor;
    expect(typeof firstCursor).toBe("string");
    expect(first).toMatchObject({
      moments: [{ id: "moment-b", targetStatus: "current" }],
    });

    const secondResponse = await GET(
      eventFor(`?page=1&limit=1&cursor=${encodeURIComponent(firstCursor)}`),
    );
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json();
    expect(second).toMatchObject({
      moments: [{ id: "moment-a", targetStatus: "current" }],
    });
    expect(second.moments[0].id).not.toBe(first.moments[0].id);
  });

  it("rejects invalid limit and cross-collection cursors in page mode", async () => {
    const invalidLimit = await GET(eventFor("?page=1&limit=101"));
    const flashbackCursor = encodeCollectionCursor("flashbacks", {
      createdAt: routeNow,
      id: "flashback-1",
    });
    const mismatched = await GET(
      eventFor(`?page=1&cursor=${encodeURIComponent(flashbackCursor)}`),
    );

    expect(invalidLimit.status).toBe(400);
    expect(mismatched.status).toBe(400);
    await expect(invalidLimit.json()).resolves.toEqual({ error: "invalid limit" });
    await expect(mismatched.json()).resolves.toEqual({ error: "invalid cursor" });
  });
});

function eventFor(search: string) {
  return createApiEvent(new Request(`http://localhost/api/moments${search}`));
}

async function seedMoments(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "trauma-moments-page-route-"));
  tempDirs.push(root);
  const config = loadRouteConfig(await writeRouteConfig(root));
  await seedRouteMemory(config, { title: "Paged Moments" });
  await writeMemoryContent({
    config,
    memoryId: routeMemoryId,
    frontmatter: {
      id: routeMemoryId,
      url: `https://example.com/${routeMemoryId}`,
      title: "Paged Moments",
      capturedAt: routeNow.toISOString(),
      extractionStatus: "success",
    },
    markdown: "# Paged Moments\n\n## Section A\n\nA.\n\n## Section B\n\nB.",
  });
  const connection = initializeDatabase(config);
  try {
    for (const suffix of ["a", "b"]) {
      const title = suffix.toUpperCase();
      await connection.repositories.moments.create({
        id: `moment-${suffix}`,
        memoryId: routeMemoryId,
        sectionAnchor: `section-${suffix}`,
        sectionTitle: `Section ${title}`,
        sectionLevel: 2,
        sectionPath: suffix === "a" ? "1/1" : "1/2",
        sectionStartOffset: null,
        sectionEndOffset: null,
        contentHash: null,
        createdAt: routeNow,
        updatedAt: routeNow,
      });
    }
  } finally {
    connection.close();
  }
}
