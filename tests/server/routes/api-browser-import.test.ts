import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  createBrowserImportPostHandler,
  OPTIONS,
  POST,
} from "../../../src/routes/api/browser-import";
import { createNonQueuingAdmissionLimiter } from "../../../src/server/concurrency/non-queuing-admission";
import { loadTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];
const browserImportToken = "0123456789abcdef0123456789abcdef";

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("browser import API route", () => {
  it("rejects excess work before reading the capture body", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = browserImportToken;
    const admissionLimiter = createNonQueuingAdmissionLimiter(1);
    const release = admissionLimiter.tryAcquire();
    let bodyReaderCalls = 0;
    const request = {
      body: {
        getReader() {
          bodyReaderCalls += 1;
          throw new Error("busy requests must not read the body");
        },
      },
      headers: new Headers({
        origin: "chrome-extension://extension-id",
        authorization: `Bearer ${browserImportToken}`,
        "content-type": "application/json",
      }),
    } as unknown as Request;
    const handler = createBrowserImportPostHandler({ admissionLimiter });

    const response = await handler(
      createApiEvent(request),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      code: "browser_import_busy",
      error: "browser import is busy",
    });
    expect(bodyReaderCalls).toBe(0);
    release?.();
  });

  it("releases browser-import admission on validation failure", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = browserImportToken;
    const admissionLimiter = createNonQueuingAdmissionLimiter(1);
    const handler = createBrowserImportPostHandler({ admissionLimiter });

    const response = await handler(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "POST",
          headers: {
            origin: "chrome-extension://extension-id",
            authorization: `Bearer ${browserImportToken}`,
            "content-type": "application/json",
          },
          body: "not-json",
        }),
      ),
    );

    expect(response.status).toBe(400);
    const release = admissionLimiter.tryAcquire();
    expect(release).toBeTypeOf("function");
    release?.();
  });

  it("releases browser-import admission when body reading is aborted", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = browserImportToken;
    const admissionLimiter = createNonQueuingAdmissionLimiter(1);
    const handler = createBrowserImportPostHandler({ admissionLimiter });
    const request = {
      body: {
        getReader() {
          return {
            read: async () => {
              throw new DOMException("request aborted", "AbortError");
            },
          };
        },
      },
      headers: new Headers({
        origin: "chrome-extension://extension-id",
        authorization: `Bearer ${browserImportToken}`,
        "content-type": "application/json",
      }),
    } as unknown as Request;

    await expect(handler(createApiEvent(request))).rejects.toMatchObject({
      name: "AbortError",
    });
    const release = admissionLimiter.tryAcquire();
    expect(release).toBeTypeOf("function");
    release?.();
  });

  it("rejects requests when browser import is disabled", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "false";

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "POST",
          headers: {
            origin: "chrome-extension://extension-id",
            authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "browser import is disabled" });
  });

  it("rejects ordinary website origins before body processing", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = browserImportToken;

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            authorization: `Bearer ${browserImportToken}`,
            "content-type": "application/json",
          },
          body: "{}",
        }),
      ),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({
      error: "browser import origin is not allowed",
    });
  });

  it("rejects invalid tokens and exposes CORS only to extension origins", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = browserImportToken;

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "POST",
          headers: {
            origin: "chrome-extension://extension-id",
            authorization: "Bearer wrong",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "chrome-extension://extension-id",
    );
    expect(await response.json()).toEqual({
      error: "browser import token is invalid",
    });
  });

  it("answers extension preflight requests", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = browserImportToken;

    const response = await OPTIONS(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "OPTIONS",
          headers: {
            origin: "chrome-extension://extension-id",
          },
        }),
      ),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
  });

  it("rejects streamed request bodies as soon as the byte cap is exceeded", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = browserImportToken;
    process.env.TRAUMA_BROWSER_IMPORT_MAX_BYTES = "100000";
    const encoder = new TextEncoder();
    let pulledChunks = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulledChunks += 1;
        if (pulledChunks > 3) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode("a".repeat(60_000)));
      },
      cancel() {
        canceled = true;
      },
    });

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "POST",
          headers: {
            origin: "chrome-extension://extension-id",
            authorization: `Bearer ${browserImportToken}`,
            "content-type": "application/json",
          },
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }),
      ),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "request body is too large",
    });
    expect(pulledChunks).toBe(2);
    expect(canceled).toBe(true);
  });

  it("maps backup failsafe errors to JSON responses with CORS", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = browserImportToken;
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    process.env.TRAUMA_CONFIG_PATH = configPath;
    await seedPathDrift(configPath, root);

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "POST",
          headers: {
            origin: "chrome-extension://extension-id",
            authorization: `Bearer ${browserImportToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sourceUrl: "https://example.com/article",
            canonicalUrl: null,
            title: "Captured",
            description: null,
            articleHtml:
              "<main><h1>Captured</h1><p>This captured article body is intentionally long enough to pass readable content validation before backup failsafe handling runs.</p></main>",
            articleText:
              "Captured article body intentionally long enough to pass readable content validation before backup failsafe handling runs.",
            selector: "main",
            extractionStrategy: "semantic_selector",
            capturedAt: new Date().toISOString(),
            extensionVersion: "0.1.0",
          }),
        }),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "chrome-extension://extension-id",
    );
    expect(body).toMatchObject({
      error: "Backup location changed",
      backupFailsafe: {
        kind: "backup_path_drift",
        availableActions: ["revert", "migrate"],
      },
    });
    expect(JSON.stringify(body)).not.toContain(join(root, "new-data"));
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

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "trauma-browser-import-api-"));
  tempDirs.push(root);
  return root;
}

async function writeConfig(root: string) {
  const configPath = join(root, "trauma.config.json");
  await writeFile(
    configPath,
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
  return configPath;
}

async function seedPathDrift(configPath: string, root: string) {
  const config = loadTraumaConfig({ configPath });
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
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812",
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
