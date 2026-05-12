import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { APIEvent } from "@solidjs/start/server";
import { transformAsync, type PluginItem } from "@babel/core";
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
  it("trims padded URLs before route validation", async () => {
    const observedUrls: string[] = [];
    const result = await parseAddMemoryPayload(
      new Request("http://localhost/api/memories", {
        method: "POST",
        body: JSON.stringify({ url: " https://example.com/padded " }),
      }),
      {
        validateUrl: async (url) => {
          observedUrls.push(url);
          return new URL(url).toString();
        },
      },
    );

    expect(result).toEqual({
      ok: true,
      url: "https://example.com/padded",
    });
    expect(observedUrls).toEqual(["https://example.com/padded"]);
  });

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

  it("keeps POST route helpers available after Vinxi pick transform", async () => {
    const source = await readFile(
      join(repositoryRoot, "src/routes/api/memories.ts"),
      "utf8",
    );
    const treeShakePlugin = await importVinxiTreeShakePlugin();
    const transformed = await transformAsync(source, {
      plugins: [[treeShakePlugin, { pick: ["POST"] }]],
      parserOpts: {
        plugins: ["typescript"],
      },
      filename: "memories.ts?pick=POST",
      ast: false,
      configFile: false,
      babelrc: false,
    });

    expect(transformed?.code).toContain(
      "parseAddMemoryPayloadInternal(event.request)",
    );
    expect(transformed?.code).toContain(
      "async function parseAddMemoryPayloadInternal",
    );
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

async function importVinxiTreeShakePlugin(): Promise<PluginItem> {
  const module = await import(
    pathToFileURL(
      join(repositoryRoot, "node_modules/vinxi/lib/plugins/tree-shake.babel.js"),
    ).href
  );

  return module.default as PluginItem;
}
