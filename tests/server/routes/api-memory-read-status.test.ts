import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { POST } from "../../../src/routes/api/memories/read-status";
import { initializeDatabase } from "../../../src/server/db";
import {
  createApiEvent,
  loadRouteConfig,
  routeMemoryId,
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

describe("memory read status API route", () => {
  it("sets read status true and false", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);

    const readResponse = await POST(
      createApiEvent(
        new Request("http://localhost/api/memories/read-status", {
          method: "POST",
          body: JSON.stringify({ memoryId: routeMemoryId, read: true }),
        }),
      ),
    );
    const unreadResponse = await POST(
      createApiEvent(
        new Request("http://localhost/api/memories/read-status", {
          method: "POST",
          body: JSON.stringify({ memoryId: routeMemoryId, read: false }),
        }),
      ),
    );

    expect(readResponse.status).toBe(200);
    expect(await readResponse.json()).toEqual({
      memoryId: routeMemoryId,
      read: true,
    });
    expect(unreadResponse.status).toBe(200);
    expect(await unreadResponse.json()).toEqual({
      memoryId: routeMemoryId,
      read: false,
    });

    const connection = initializeDatabase(config);
    try {
      expect(
        connection.sqlite
          .prepare("select read from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ read: 0 });
    } finally {
      connection.close();
    }
  });

  it("rejects malformed read status payloads", async () => {
    const root = await makeRoot();
    loadRouteConfig(await writeRouteConfig(root));

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/memories/read-status", {
          method: "POST",
          body: JSON.stringify({
            memoryId: routeMemoryId,
            read: true,
            extra: true,
          }),
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "request body must contain only memoryId and read",
    });
  });

  it("returns not found for a missing memory", async () => {
    const root = await makeRoot();
    loadRouteConfig(await writeRouteConfig(root));

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/memories/read-status", {
          method: "POST",
          body: JSON.stringify({ memoryId: "missing-memory", read: true }),
        }),
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "memory was not found" });
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-api-read-"));
  tempDirs.push(root);
  return root;
}
