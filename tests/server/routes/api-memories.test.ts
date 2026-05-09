import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseAddMemoryPayload,
  POST,
} from "../../../src/routes/api/memories";

const tempDirs: string[] = [];

afterEach(async () => {
  process.chdir(repositoryRoot);
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const repositoryRoot = process.cwd();

describe("memories API route", () => {
  it("bounds route URL preflight validation", async () => {
    const result = await parseAddMemoryPayload(
      new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/slow-dns" }),
      }),
      {
        validateUrl: async () => new Promise(() => {}),
        validationTimeoutMs: 1,
      },
    );

    expect(result).toEqual({
      ok: false,
      error: "url validation timed out",
    });
  });

  it("does not expose local config paths in client errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-api-memory-"));
    tempDirs.push(root);
    process.chdir(root);

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/memories", {
          method: "POST",
          body: JSON.stringify({ url: "http://93.184.216.34/article" }),
        }),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "failed to load Trauma configuration" });
    expect(JSON.stringify(body)).not.toContain(root);
  });
});

function createApiEvent(request: Request): APIEvent {
  return {
    request,
    params: {},
    response: new Response(),
    locals: {},
    nativeEvent: {},
  } as unknown as APIEvent;
}
