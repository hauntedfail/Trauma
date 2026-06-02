import type { APIEvent } from "@solidjs/start/server";
import { describe, expect, it } from "vitest";

import {
  createReadPsychiatristThreadHandler,
  createStartPsychiatristThreadHandler,
} from "../../../src/server/psychiatrist/thread-route";
import type { PsychiatristMemoryContext } from "../../../src/server/psychiatrist/types";

const MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001";
const THREAD_ID = "019e8a00-0000-7000-8000-000000000001";

describe("Psychiatrist thread API routes", () => {
  it("creates a source thread and returns safe reader-facing JSON", async () => {
    const created: unknown[] = [];
    const handler = createStartPsychiatristThreadHandler({
      buildContext: async (input) => {
        expect(input.memoryId).toBe(MEMORY_ID);
        expect(input.langCode).toBeUndefined();
        return context();
      },
      config: { storePath: "/private/tmp/secret-store" },
      createThread: async (input) => {
        created.push(input.manifest);
      },
      generateId: () => THREAD_ID,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads`, {
          body: "{}",
          method: "POST",
        }),
        { memoryId: MEMORY_ID },
      ),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      active_turn: null,
      content_hash: "sha256:context",
      lang_code: null,
      memory_id: MEMORY_ID,
      pairs: [],
      status: "ready",
      thread_id: THREAD_ID,
      variant_kind: "source",
    });
    expect(JSON.stringify(body)).not.toContain("/private/tmp/secret-store");
    expect(JSON.stringify(body)).not.toContain("Raw markdown");
    expect(created).toEqual([
      expect.objectContaining({
        activeContentHash: "sha256:context",
        memoryId: MEMORY_ID,
        status: "ready",
        threadId: THREAD_ID,
        variantKind: "source",
      }),
    ]);
  });

  it("creates a translated thread with lang code in the manifest and response", async () => {
    const created: unknown[] = [];
    const handler = createStartPsychiatristThreadHandler({
      buildContext: async (input) => {
        expect(input.langCode).toBe("ja-JP");
        return context({
          contentHash: "sha256:translated",
          langCode: "ja-JP",
          relativePath: `memories/${MEMORY_ID}/ja-JP/CONTENT.md`,
          variantKind: "translation",
        });
      },
      config: { storePath: "/private/tmp/secret-store" },
      createThread: async (input) => {
        created.push(input.manifest);
      },
      generateId: () => THREAD_ID,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads`, {
          body: JSON.stringify({ lang_code: "ja-JP" }),
          method: "POST",
        }),
        { memoryId: MEMORY_ID },
      ),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      content_hash: "sha256:translated",
      lang_code: "ja-JP",
      thread_id: THREAD_ID,
      variant_kind: "translation",
    });
    expect(created).toEqual([
      expect.objectContaining({
        activeContentHash: "sha256:translated",
        langCode: "ja-JP",
        translationOutputHash: "sha256:translated",
        variantKind: "translation",
      }),
    ]);
  });

  it("rejects malformed thread create payloads", async () => {
    const handler = createStartPsychiatristThreadHandler({
      buildContext: async () => context(),
      config: { storePath: "/tmp/store" },
      createThread: async () => undefined,
      generateId: () => THREAD_ID,
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads`, {
          body: JSON.stringify({ lang_code: "" }),
          method: "POST",
        }),
        { memoryId: MEMORY_ID },
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      action: "retry",
      code: "invalid_request",
      message: "lang_code must be a non-empty string when provided.",
      status: "error",
    });
  });

  it("reads a stored thread as safe JSON", async () => {
    const handler = createReadPsychiatristThreadHandler({
      config: { storePath: "/private/tmp/secret-store" },
      loadThread: async () => ({
        manifest: {
          activeContentHash: "sha256:context",
          createdAt: "2026-06-01T00:00:00.000Z",
          memoryId: MEMORY_ID,
          policyVersion: "psychiatrist-memory-v1",
          sourceHash: "sha256:source",
          status: "ready",
          threadId: THREAD_ID,
          updatedAt: "2026-06-01T00:00:00.000Z",
          variantKind: "source",
        },
        pairs: [],
      }),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}`),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      active_turn: null,
      content_hash: "sha256:context",
      lang_code: null,
      memory_id: MEMORY_ID,
      pairs: [],
      status: "ready",
      thread_id: THREAD_ID,
      variant_kind: "source",
    });
    expect(JSON.stringify(body)).not.toContain("/private/tmp/secret-store");
  });
});

function context(
  input: Partial<PsychiatristMemoryContext> = {},
): PsychiatristMemoryContext {
  return {
    categories: [],
    contentHash: "sha256:context",
    memoryId: MEMORY_ID,
    relativePath: `memories/${MEMORY_ID}/CONTENT.md`,
    sections: [
      {
        anchor: "document",
        endOffset: 12,
        level: 1,
        markdown: "Raw markdown",
        path: "document",
        startOffset: 0,
        title: "Document",
      },
    ],
    sourceUrl: "https://example.com/memory",
    tags: [],
    title: "Memory",
    variantKind: "source",
    ...input,
  };
}

function createApiEvent(request: Request, params: Record<string, string>): APIEvent {
  return {
    request,
    params,
    response: new Response(),
    locals: {},
    nativeEvent: {},
  } as unknown as APIEvent;
}
