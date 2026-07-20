import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { APIEvent } from "@solidjs/start/server";
import { transformAsync, type PluginItem } from "@babel/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryPostHandler,
  parseAddMemoryPayload,
  POST,
} from "../../../src/routes/api/memories";
import { loadTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { ImportAdmissionError } from "../../../src/server/importer";

const tempDirs: string[] = [];

afterEach(async () => {
  process.chdir(repositoryRoot);
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const repositoryRoot = process.cwd();

describe("memories API route", () => {
  it("maps import admission overflow to a stable retryable response", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-api-memory-busy-"));
    tempDirs.push(root);
    process.chdir(root);
    await writeNoBackupConfig(root);
    let importCalls = 0;
    const handler = createMemoryPostHandler({
      createImporter: () => ({
        validateUrl: async (url) => new URL(url).toString(),
        importUrl: async () => {
          importCalls += 1;
          throw new ImportAdmissionError();
        },
      }),
    });

    const response = await handler(
      createApiEvent(
        new Request("http://localhost/api/memories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "https://example.com/busy" }),
        }),
      ),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      code: "import_busy",
      error: "memory import is busy",
    });
    expect(importCalls).toBe(1);
  });

  it("rejects malformed idempotency keys before configuration or filesystem work", async () => {
    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/memories", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "../../arbitrary-memory",
          },
          body: JSON.stringify({ url: "https://example.com/article" }),
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Idempotency-Key must be a UUID v7",
    });
  });

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

  it("maps backup failsafe errors to stable JSON responses", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-api-memory-"));
    tempDirs.push(root);
    process.chdir(root);
    await writeConfig(root);
    await seedPathDrift(root);
    const config = loadTraumaConfig();

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/memories", {
          method: "POST",
          body: JSON.stringify({ url: "http://93.184.216.34/article" }),
        }),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "Backup location changed",
      backupFailsafe: {
        kind: "backup_path_drift",
        availableActions: ["revert", "migrate"],
      },
    });
    expect(JSON.stringify(body)).not.toContain(config.projectPath);
    expect(JSON.stringify(body)).not.toContain(config.storePath);
  });

  it("maps a terminal idempotency replay without a memory to a stable conflict", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-api-memory-"));
    tempDirs.push(root);
    process.chdir(root);
    await writeConfig(root);
    const config = loadTraumaConfig();
    const connection = initializeDatabase(config);
    const idempotencyKey = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812";
    try {
      await connection.repositories.memories.reserveCreationIdempotency({
        idempotencyKey,
        requestUrl: "http://93.184.216.34/article",
        createdAt: new Date("2026-05-13T00:00:00.000Z"),
      });
    } finally {
      connection.close();
    }

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/memories", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({ url: "http://93.184.216.34/article" }),
        }),
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Idempotency-Key no longer refers to an existing memory",
    });
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
      "parseAddMemoryPayloadInternal(event.request, {",
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

async function writeConfig(root: string) {
  await writeFile(
    join(root, "trauma.config.json"),
    JSON.stringify(
      {
        projectPath: "./new-data",
        storePath: "./new-data/storage",
        databasePath: "./.trauma/trauma.sqlite",
        backup: {
          git: {
            enabled: true,
            remote: "origin",
            branch: "main",
            push: false,
            commitMessageTemplate: "backup memory {memoryId}",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function writeNoBackupConfig(root: string) {
  await writeFile(
    join(root, "trauma.config.json"),
    JSON.stringify(
      {
        projectPath: "./data",
        storePath: "./data/storage",
        databasePath: "./.trauma/trauma.sqlite",
        backup: {
          git: {
            enabled: false,
            remote: "origin",
            branch: "main",
            push: false,
            commitMessageTemplate: "backup memory {memoryId}",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function seedPathDrift(root: string) {
  const config = loadTraumaConfig();
  const now = new Date("2026-05-13T00:00:00.000Z");
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
      id: "default",
      projectPath: join(root, "old-data"),
      storePath: join(root, "old-data/storage"),
      gitRemote: "origin",
      gitRemoteUrl: null,
      gitBranch: "main",
      createdAt: now,
      updatedAt: now,
    });
    await connection.repositories.memories.create({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef811",
      url: "https://example.com/existing",
      title: "Existing",
      description: null,
      faviconUrl: null,
      contentPath: "memories/existing/CONTENT.md",
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "success",
      lastBackupAt: now,
      lastBackupError: null,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }
}

async function importVinxiTreeShakePlugin(): Promise<PluginItem> {
  const module = await import(
    pathToFileURL(
      join(repositoryRoot, "node_modules/vinxi/lib/plugins/tree-shake.babel.js"),
    ).href
  );

  return module.default as PluginItem;
}
