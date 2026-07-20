import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSendPsychiatristMessageHandler } from "../../../src/server/psychiatrist/message-route";
import { createCancelPsychiatristTurnHandler } from "../../../src/server/psychiatrist/cancel-route";
import { createRegeneratePsychiatristResponseHandler } from "../../../src/server/psychiatrist/regenerate-route";
import { createPsychiatristTurnEventsHandler } from "../../../src/server/psychiatrist/events-route";
import {
  ActivePsychiatristTurnRegistry,
  activePsychiatristTurns,
} from "../../../src/server/psychiatrist/active-turns";
import {
  appendPsychiatristStreamEvent,
  loadPsychiatristStreamReplay,
} from "../../../src/server/psychiatrist/stream-store";
import { PSYCHIATRIST_PROMPT_POLICY_VERSION } from "../../../src/server/psychiatrist/prompt";
import {
  PSYCHIATRIST_RUNTIME_ISOLATION_ASSERTION,
  PSYCHIATRIST_RUNTIME_ISOLATION_ENV,
} from "../../../src/server/psychiatrist/runtime-isolation";
import {
  appendAssistantResponse,
  appendRegeneratedAssistantResponse,
  appendPendingPair,
  createPsychiatristThread,
  loadPsychiatristThread,
  markPsychiatristThreadStale,
} from "../../../src/server/psychiatrist/thread-store";
import { initializeDatabase } from "../../../src/server/db";
import {
  createReadPsychiatristThreadHandler,
  createStartPsychiatristThreadHandler,
  reconcileThreadForResponse,
} from "../../../src/server/psychiatrist/thread-route";
import { PsychiatristContextError } from "../../../src/server/psychiatrist/context";
import { writeMemoryContent } from "../../../src/server/store";
import { createSha256ContentHash } from "../../../src/server/translation/hash";
import { CodexAppServerError } from "../../../src/server/translation/codex-app-server";
import type {
  PsychiatristMemoryContext,
  PsychiatristSourceCitation,
  PsychiatristThreadManifest,
} from "../../../src/server/psychiatrist/types";
import type {
  CodexAppServerEvent,
  CodexConversationClient,
  CodexConversationTurnInput,
  CodexConversationTurnResult,
} from "../../../src/server/translation/codex-app-server";

const MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001";
const MEMORY_ID_2 = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f002";
const THREAD_ID = "019e8a00-0000-7000-8000-000000000001";
const THREAD_ID_2 = "019e8a00-0000-7000-8000-000000000006";
const PAIR_ID = "019e8a00-0000-7000-8000-000000000002";
const TURN_ID = "019e8a00-0000-7000-8000-000000000003";
const EXTRA_TURN_IDS = [
  "019e8a00-0000-7000-8000-000000000004",
  "019e8a00-0000-7000-8000-000000000005",
];

describe("Psychiatrist thread API routes", () => {
  afterEach(() => {
    activePsychiatristTurns.clear();
  });

  it("counts reserved and active turns against one fixed capacity", () => {
    const activeTurns = new ActivePsychiatristTurnRegistry(1);

    expect(activeTurns.tryReserveThread("thread-reserved")).toBe("reserved");
    expect(activeTurns.tryReserveThread("thread-overflow")).toBe(
      "capacity_exceeded",
    );
    activeTurns.register({
      client: new HangingConversationClient(),
      memoryId: MEMORY_ID,
      pairId: PAIR_ID,
      threadId: "thread-reserved",
      turnId: TURN_ID,
    });
    expect(activeTurns.tryReserveThread("thread-still-full")).toBe(
      "capacity_exceeded",
    );

    activeTurns.unregister(TURN_ID);
    expect(activeTurns.tryReserveThread("thread-after-release")).toBe("reserved");
    activeTurns.releaseThread("thread-after-release");
  });

  it("reconciles an unchanged thread generation only once", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-reconcile-cache-"));
    const thread = { manifest: manifest(), pairs: [] };
    const reconcile = vi.fn(async () => false);
    const reloadThread = vi.fn(async () => thread);

    await reconcileThreadForResponse(
      { config: { storePath }, reloadThread, thread },
      { reconcile },
    );
    await reconcileThreadForResponse(
      { config: { storePath }, reloadThread, thread },
      { reconcile },
    );

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reloadThread).not.toHaveBeenCalled();

    const updatedThread = {
      ...thread,
      manifest: { ...thread.manifest, updatedAt: "2026-06-01T00:00:01.000Z" },
    };
    await reconcileThreadForResponse(
      { config: { storePath }, reloadThread, thread: updatedThread },
      { reconcile },
    );
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

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

  it("creates a translation-scoped thread from the active translated reader", async () => {
    const created: unknown[] = [];
    const handler = createStartPsychiatristThreadHandler({
      buildContext: async (input) => {
        expect(input.langCode).toBe("ja-JP");
        return context({
          contentHash: "sha256:translated",
          langCode: "ja-JP",
          relativePath: `memories/${MEMORY_ID}/ja-JP/CONTENT.md`,
          sourceHash: "sha256:source",
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
        sourceHash: "sha256:source",
        variantKind: "translation",
      }),
    ]);
  });

  it("resumes the latest matching thread when requested", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-resume-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const handler = createStartPsychiatristThreadHandler({
      buildContext: async () => context(),
      config: { storePath },
      generateId: () => THREAD_ID_2,
      now: () => new Date("2026-06-01T00:00:01.000Z"),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads`, {
          body: JSON.stringify({ resume_latest: true }),
          method: "POST",
        }),
        { memoryId: MEMORY_ID },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      content_hash: "sha256:context",
      memory_id: MEMORY_ID,
      thread_id: THREAD_ID,
      variant_kind: "source",
    });
  });

  it("does not resume a source thread for a translated reader of the same memory", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-resume-translated-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({
        activeContentHash: "sha256:source",
        sourceHash: "sha256:source",
        variantKind: "source",
      }),
    });
    const created: unknown[] = [];
    const handler = createStartPsychiatristThreadHandler({
      buildContext: async (input) => {
        expect(input.langCode).toBe("ja-JP");
        return context({
          contentHash: "sha256:translated-ja",
          langCode: "ja-JP",
          relativePath: `memories/${MEMORY_ID}/ja-JP/CONTENT.md`,
          sourceHash: "sha256:source",
          translationOutputHash: "sha256:translated-ja",
          variantKind: "translation",
        });
      },
      config: { storePath },
      createThread: async (input) => {
        created.push(input.manifest);
        await createPsychiatristThread(input);
      },
      generateId: () => THREAD_ID_2,
      now: () => new Date("2026-06-01T00:00:01.000Z"),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads`, {
          body: JSON.stringify({ lang_code: "ja-JP", resume_latest: true }),
          method: "POST",
        }),
        { memoryId: MEMORY_ID },
      ),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      content_hash: "sha256:translated-ja",
      lang_code: "ja-JP",
      memory_id: MEMORY_ID,
      thread_id: THREAD_ID_2,
      variant_kind: "translation",
    });
    expect(created).toEqual([
      expect.objectContaining({
        activeContentHash: "sha256:translated-ja",
        langCode: "ja-JP",
        sourceHash: "sha256:source",
        threadId: THREAD_ID_2,
        translationOutputHash: "sha256:translated-ja",
        variantKind: "translation",
      }),
    ]);
  });

  it("does not resume a latest thread from an older prompt policy version", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-resume-policy-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({ policyVersion: "psychiatrist-memory-pairs-old" }),
    });
    const handler = createStartPsychiatristThreadHandler({
      buildContext: async () => context(),
      config: { storePath },
      generateId: () => THREAD_ID_2,
      now: () => new Date("2026-06-01T00:00:01.000Z"),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads`, {
          body: JSON.stringify({ resume_latest: true }),
          method: "POST",
        }),
        { memoryId: MEMORY_ID },
      ),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      thread_id: THREAD_ID_2,
    });
  });

  it("returns active turn metadata when resuming or reading a running thread", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-active-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    activePsychiatristTurns.register({
      client: new HangingConversationClient(),
      memoryId: MEMORY_ID,
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const startHandler = createStartPsychiatristThreadHandler({
      buildContext: async () => context(),
      config: { storePath },
      generateId: () => THREAD_ID_2,
      now: () => new Date("2026-06-01T00:00:01.000Z"),
    });

    const resumed = await startHandler(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads`, {
          body: JSON.stringify({ resume_latest: true }),
          method: "POST",
        }),
        { memoryId: MEMORY_ID },
      ),
    );

    expect(resumed.status).toBe(200);
    await expect(resumed.json()).resolves.toMatchObject({
      active_turn: {
        event_url: psychiatristEventsUrl(TURN_ID),
        pair_id: PAIR_ID,
        status: "running",
        turn_id: TURN_ID,
      },
      thread_id: THREAD_ID,
    });

    const readHandler = createReadPsychiatristThreadHandler({
      config: { storePath },
    });
    const read = await readHandler(
      createApiEvent(
        new Request(
          `http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads/${THREAD_ID}?variant_kind=source`,
        ),
        { memoryId: MEMORY_ID, threadId: THREAD_ID },
      ),
    );

    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      active_turn: {
        event_url: psychiatristEventsUrl(TURN_ID),
        pair_id: PAIR_ID,
        status: "running",
        turn_id: TURN_ID,
      },
      thread_id: THREAD_ID,
    });
  });

  it("reconciles unreachable pending turns before returning a restarted thread", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-restart-orphan-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      client: new HangingConversationClient(),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    const sendResponse = await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "This turn will be orphaned." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    expect(sendResponse.status).toBe(202);
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "pending" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) !== undefined;
    });

    activePsychiatristTurns.clear();
    const readResponse = await createReadPsychiatristThreadHandler({
      config: { storePath },
    })(
      createApiEvent(
        new Request(
          `http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads/${THREAD_ID}?variant_kind=source`,
        ),
        { memoryId: MEMORY_ID, threadId: THREAD_ID },
      ),
    );

    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      active_turn: null,
      pairs: [
        {
          pair_id: PAIR_ID,
          status: "failed",
          turn_id: TURN_ID,
        },
      ],
    });
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      safe_error: { code: "turn_interrupted" },
      status: "failed",
    });
  });

  it("defers pending-turn reconciliation while a thread is reserved", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-reserved-read-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    expect(activePsychiatristTurns.reserveThread(THREAD_ID)).toBe(true);
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: {
        ...context(),
        contextSnapshotId: "snapshot-1",
        policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
        selectedSectionAnchors: [],
        selectedSectionHashes: [],
        userPrompt: "This turn is still being registered.",
      },
      pairId: PAIR_ID,
      prompt: "This turn is still being registered.",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    const readResponse = await createReadPsychiatristThreadHandler({
      config: { storePath },
    })(
      createApiEvent(
        new Request(
          `http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads/${THREAD_ID}?variant_kind=source`,
        ),
        { memoryId: MEMORY_ID, threadId: THREAD_ID },
      ),
    );

    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      active_turn: null,
      pairs: [
        {
          pair_id: PAIR_ID,
          status: "pending",
          turn_id: TURN_ID,
        },
      ],
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        pairId: PAIR_ID,
        status: "pending",
        turnId: TURN_ID,
      }),
    ]);
  });

  it("reconciles unreachable pending turns before returning a resumed latest thread", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-resume-restart-orphan-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      client: new HangingConversationClient(),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    const sendResponse = await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "This resumed turn will be orphaned." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    expect(sendResponse.status).toBe(202);
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "pending" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) !== undefined;
    });

    activePsychiatristTurns.clear();
    const resumeResponse = await createStartPsychiatristThreadHandler({
      buildContext: async () => context(),
      config: { storePath },
      generateId: () => THREAD_ID_2,
      now: () => new Date("2026-06-01T00:00:01.000Z"),
    })(
      createApiEvent(
        new Request(`http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads`, {
          body: JSON.stringify({ resume_latest: true }),
          method: "POST",
        }),
        { memoryId: MEMORY_ID },
      ),
    );

    expect(resumeResponse.status).toBe(200);
    await expect(resumeResponse.json()).resolves.toMatchObject({
      active_turn: null,
      pairs: [
        {
          pair_id: PAIR_ID,
          status: "failed",
          turn_id: TURN_ID,
        },
      ],
      thread_id: THREAD_ID,
    });
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      safe_error: { code: "turn_interrupted" },
      status: "failed",
    });
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

  it("rejects cross-origin and non-JSON state-changing requests before work starts", async () => {
    const messageClient = new FakeConversationClient("must not run");
    const messageHandler = createSendPsychiatristMessageHandler({
      client: messageClient,
      config: { storePath: "/tmp/store" },
    });
    const crossOriginMessage = await messageHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: "message=csrf",
          headers: {
            "content-type": "text/plain",
            origin: "https://evil.example",
          },
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    const sameOriginTextMessage = await messageHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: "message=csrf",
          headers: {
            "content-type": "text/plain",
            origin: "http://localhost",
          },
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(crossOriginMessage.status).toBe(403);
    await expect(crossOriginMessage.json()).resolves.toMatchObject({
      code: "invalid_request",
      message: "same-origin request is required.",
    });
    expect(sameOriginTextMessage.status).toBe(415);
    await expect(sameOriginTextMessage.json()).resolves.toMatchObject({
      code: "invalid_request",
      message: "content-type must be application/json.",
    });
    expect(messageClient.inputs).toEqual([]);
  });

  it("reads a stored thread as safe JSON", async () => {
    const handler = createReadPsychiatristThreadHandler({
      config: { storePath: "/private/tmp/secret-store" },
      loadThread: async (input) => {
        expect(input.memoryId).toBe(MEMORY_ID);
        expect(input.threadId).toBe(THREAD_ID);
        return {
          manifest: {
            activeContentHash: "sha256:context",
            createdAt: "2026-06-01T00:00:00.000Z",
            memoryId: MEMORY_ID,
            policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
            sourceHash: "sha256:source",
            status: "ready",
            threadId: THREAD_ID,
            updatedAt: "2026-06-01T00:00:00.000Z",
            variantKind: "source",
          },
          pairs: [
            {
              assistant: undefined,
              pairId: PAIR_ID,
              status: "pending",
              turnId: TURN_ID,
              user: {
                content: "What is next?",
                createdAt: "2026-06-01T00:00:01.000Z",
              },
            },
          ],
        };
      },
    });

    const response = await handler(
      createApiEvent(
        new Request(
          `http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads/${THREAD_ID}?variant_kind=source`,
        ),
        { memoryId: MEMORY_ID, threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      active_turn: null,
      content_hash: "sha256:context",
      lang_code: null,
      memory_id: MEMORY_ID,
      pairs: [
        {
          pair_id: PAIR_ID,
          status: "pending",
          turn_id: TURN_ID,
          user_prompt: {
            content: "What is next?",
            created_at: "2026-06-01T00:00:01.000Z",
          },
        },
      ],
      status: "ready",
      thread_id: THREAD_ID,
      variant_kind: "source",
    });
    expect(JSON.stringify(body)).not.toContain("/private/tmp/secret-store");
  });

  it("sanitizes citations at the thread API response boundary", async () => {
    const handler = createReadPsychiatristThreadHandler({
      config: { storePath: "/private/tmp/secret-store" },
      loadThread: async () => ({
        manifest: manifest(),
        pairs: [
          {
            assistant: {
              citations: [
                {
                  sourceId: "legacy-public",
                  title: "  Public source  ",
                  url: "https://example.com/release?token=secret#section",
                },
                {
                  sourceId: "legacy-internal",
                  title: "Internal source",
                  url: "https://release.intranet.corp/notes",
                },
              ],
              completedAt: "2026-06-01T00:00:02.000Z",
              content: "A cited answer.",
            },
            pairId: PAIR_ID,
            status: "completed",
            turnId: TURN_ID,
            user: {
              content: "What changed?",
              createdAt: "2026-06-01T00:00:01.000Z",
            },
          },
        ],
      }),
    });

    const response = await handler(
      createApiEvent(
        new Request(
          `http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads/${THREAD_ID}?variant_kind=source`,
        ),
        { memoryId: MEMORY_ID, threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pairs: [
        {
          assistant_response: {
            source_citations: [
              {
                source_id: "source-1",
                title: "Public source",
                url: "https://example.com/release",
              },
            ],
          },
        },
      ],
    });
  });

  it("does not discover a thread owned by another memory", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-scoped-read-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({ memoryId: MEMORY_ID_2 }),
    });
    const handler = createReadPsychiatristThreadHandler({
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(
          `http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads/${THREAD_ID}?variant_kind=source`,
        ),
        { memoryId: MEMORY_ID, threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      action: "open_reader",
      code: "thread_not_found",
      message: "Psychiatrist thread was not found.",
      status: "error",
    });
  });

  it("rejects cross-memory and cross-variant messages before any turn side effect", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-scope-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new FakeConversationClient("must not run");
    const backupEnqueues: unknown[] = [];
    const handler = createSendPsychiatristMessageHandler({
      backupQueue: {
        enqueue: async (input, finalizer) => {
          backupEnqueues.push(input);
          const result = { backupStatus: "queued" } as const;
          await finalizer?.(result);
          return result;
        },
        persistIntent: async () => ({ backupStatus: "pending" }),
      },
      client,
      config: { storePath },
    });

    const crossMemory = await handler(
      createApiEvent(
        new Request("http://localhost/cross-memory/messages", {
          body: JSON.stringify({ message: "Wrong memory", variant_kind: "source" }),
          method: "POST",
        }),
        { memoryId: MEMORY_ID_2, threadId: THREAD_ID },
      ),
    );
    const crossVariant = await handler(
      createApiEvent(
        new Request("http://localhost/cross-variant/messages", {
          body: JSON.stringify({
            lang_code: "ja-JP",
            message: "Wrong variant",
            variant_kind: "translation",
          }),
          method: "POST",
        }),
        { memoryId: MEMORY_ID, threadId: THREAD_ID },
      ),
    );

    expect(crossMemory.status).toBe(404);
    expect(crossVariant.status).toBe(409);
    await expect(crossVariant.json()).resolves.toMatchObject({
      code: "thread_scope_mismatch",
    });
    expect(client.inputs).toEqual([]);
    expect(backupEnqueues).toEqual([]);
    expect(activePsychiatristTurns.hasActiveOrReservedThread(THREAD_ID)).toBe(false);
    await expect(loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    })).resolves.toMatchObject({ pairs: [] });
  });

  it("sends a message, persists the pair, and records replayable stream events", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new FakeConversationClient("The memory says rollback is missing.");
    const backupEnqueues: unknown[] = [];
    const enqueueReplayTypes: Array<{ phase: "before_finalizer" | "after_finalizer"; types: string[] }> = [];
    const intentStates: Array<{ pairStatus: string | undefined; terminalVisible: boolean }> = [];
    const handler = createSendPsychiatristMessageHandler({
      backupQueue: {
        enqueue: async (input, finalizer) => {
          const replayBeforeFinalizer = await loadPsychiatristStreamReplay({
            config: { storePath },
            memoryId: MEMORY_ID,
            threadId: THREAD_ID,
            turnId: TURN_ID,
          });
          enqueueReplayTypes.push({
            phase: "before_finalizer",
            types: replayBeforeFinalizer.map((event) => event.type),
          });
          backupEnqueues.push(input);
          const result = { backupStatus: "queued" } as const;
          await finalizer?.(result);
          const replayAfterFinalizer = await loadPsychiatristStreamReplay({
            config: { storePath },
            memoryId: MEMORY_ID,
            threadId: THREAD_ID,
            turnId: TURN_ID,
          });
          enqueueReplayTypes.push({
            phase: "after_finalizer",
            types: replayAfterFinalizer.map((event) => event.type),
          });
          return result;
        },
        persistIntent: async () => {
          const loaded = await loadPsychiatristThread({
            config: { storePath },
            threadId: THREAD_ID,
          });
          const replay = await loadPsychiatristStreamReplay({
            config: { storePath },
            memoryId: MEMORY_ID,
            threadId: THREAD_ID,
            turnId: TURN_ID,
          });
          intentStates.push({
            pairStatus: loaded.pairs[0]?.status,
            terminalVisible: replay.some((event) => event.type === "psychiatrist.answer.completed"),
          });
          return { backupStatus: "pending" };
        },
      },
      buildContext: async () => context({
        sections: [
          {
            anchor: "risks",
            endOffset: 28,
            level: 2,
            markdown: "## Risks\n\nNo rollback plan.",
            path: "1.1",
            startOffset: 0,
            title: "Risks",
          },
        ],
      }),
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({
            message: "What is the risk?",
            web_source_permission: "deny",
          }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      event_url: psychiatristEventsUrl(TURN_ID),
      pair_id: PAIR_ID,
      replay_url: psychiatristEventsUrl(TURN_ID),
      status: "started",
      thread_id: THREAD_ID,
      turn_id: TURN_ID,
    });
    expect(client.inputs).toEqual([
      expect.objectContaining({
        cwdPurpose: "psychiatrist",
        input: expect.stringContaining("No rollback plan."),
        networkAccess: "disabled",
      }),
    ]);
    expect(client.inputs[0]?.input).toContain("What is the risk?");

    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      });
      return loaded.pairs[0]?.status === "completed" &&
        replay.some((event) => event.type === "psychiatrist.answer.completed");
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({
          content: "The memory says rollback is missing.",
        }),
        pairId: PAIR_ID,
        status: "completed",
      }),
    ]);
    await expect(
      readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "pairs",
          PAIR_ID,
          "RESPONSE.md",
        ),
        "utf8",
      ),
    ).resolves.toBe("The memory says rollback is missing.");
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.turn.started",
      "psychiatrist.process.delta",
      "psychiatrist.answer.delta",
      "psychiatrist.answer.completed",
    ]);
    expect(replay[0]?.data).toEqual({
      pair_id: PAIR_ID,
      status: "running",
      user_prompt: "What is the risk?",
    });
    expect(replay[3]?.data).toEqual({
      pair_id: PAIR_ID,
      source_citations: [],
      text: "The memory says rollback is missing.",
    });
    expect(enqueueReplayTypes).toEqual([
      {
        phase: "before_finalizer",
        types: [
          "psychiatrist.turn.started",
          "psychiatrist.process.delta",
          "psychiatrist.answer.delta",
        ],
      },
      {
        phase: "after_finalizer",
        types: [
          "psychiatrist.turn.started",
          "psychiatrist.process.delta",
          "psychiatrist.answer.delta",
          "psychiatrist.answer.completed",
        ],
      },
    ]);
    expect(intentStates).toEqual([{ pairStatus: "pending", terminalVisible: false }]);
    expect(backupEnqueues).toEqual([
      {
        contentPaths: [
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/THREAD.json`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/THREAD.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/pairs/${PAIR_ID}/PROMPT.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/pairs/${PAIR_ID}/CONTEXT.json`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/pairs/${PAIR_ID}/RESPONSE.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/PAIRS.jsonl`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/turns/${TURN_ID}.json`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/streams/${TURN_ID}.jsonl`,
        ],
        memoryId: MEMORY_ID,
        reason: "psychiatrist_thread_update",
      },
    ]);
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl"),
        "utf8",
      ).then((content) => content.trim().split("\n").map((line) => JSON.parse(line))),
    ).resolves.toContainEqual(
      expect.objectContaining({
        pair_id: PAIR_ID,
        status: "completed",
        stream_path: `memories/${MEMORY_ID}/threads/${THREAD_ID}/streams/${TURN_ID}.jsonl`,
      }),
    );
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      completed_at: expect.any(String),
      pair_id: PAIR_ID,
      policy_version: PSYCHIATRIST_PROMPT_POLICY_VERSION,
      started_at: expect.any(String),
      status: "completed",
      thread_id: THREAD_ID,
      turn_id: TURN_ID,
    });
    expect(JSON.stringify(replay)).not.toContain("/private/");
  });

  it("uses the current translated reader context for a translation-scoped thread", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-translated-context-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({
        activeContentHash: "sha256:translated-ja",
        langCode: "ja-JP",
        sourceHash: "sha256:source",
        translationOutputHash: "sha256:translated-ja",
        variantKind: "translation",
      }),
    });
    const client = new FakeConversationClient("Answer from translated context.");
    const handler = createSendPsychiatristMessageHandler({
      buildContext: async (input) => {
        expect(input.langCode).toBe("ja-JP");
        return context({
          contentHash: "sha256:translated-ja",
          langCode: "ja-JP",
          relativePath: `memories/${MEMORY_ID}/ja-JP/CONTENT.md`,
          sections: [
            {
              anchor: "translated",
              endOffset: 19,
              level: 1,
              markdown: "Translated markdown",
              path: "document",
              startOffset: 0,
              title: "Translated",
            },
          ],
          sourceHash: "sha256:source",
          translationOutputHash: "sha256:translated-ja",
          variantKind: "translation",
        });
      },
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({
            lang_code: "ja-JP",
            message: "Explain this translated page.",
            variant_kind: "translation",
            web_source_permission: "deny",
          }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(() => client.inputs.length === 1);
    expect(String(client.inputs[0]?.input)).toContain("Translated markdown");
    await waitFor(async () => {
      const contextRecord = await readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "pairs",
          PAIR_ID,
          "CONTEXT.json",
        ),
        "utf8",
      ).then(parseJsonRecord);
      return contextRecord.lang_code === "ja-JP" &&
        contextRecord.variant_kind === "translation" &&
        contextRecord.translation_output_hash === "sha256:translated-ja";
    });
  });

  it("persists only prompt-selected context sections for a new turn snapshot", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-selected-context-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new FakeConversationClient("The selected context answers this.");
    const selectedMarkdown = "## Risk\n\nRollback is missing.";
    const handler = createSendPsychiatristMessageHandler({
      buildContext: async () => context({
        sections: [
          {
            anchor: "appendix",
            endOffset: 90_000,
            level: 2,
            markdown: `## Appendix\n\n${"irrelevant ".repeat(10_000)}`,
            path: "1.1",
            startOffset: 0,
            title: "Appendix",
          },
          {
            anchor: "risk",
            endOffset: 90_200,
            level: 2,
            markdown: selectedMarkdown,
            path: "1.2",
            startOffset: 90_001,
            title: "Risk",
          },
        ],
      }),
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({
            message: "What is the risk?",
            web_source_permission: "deny",
          }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(async () => {
      const contextRecord = await readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "pairs",
          PAIR_ID,
          "CONTEXT.json",
        ),
        "utf8",
      ).then(parseJsonRecord);
      return Array.isArray(contextRecord.sections);
    });
    const sentPrompt = String(client.inputs[0]?.input);
    expect(sentPrompt).toContain('"title":"Risk"');
    expect(sentPrompt).not.toContain('"title":"Appendix"');

    const contextRecord = await readFile(
      join(
        storePath,
        "memories",
        MEMORY_ID,
        "threads",
        THREAD_ID,
        "pairs",
        PAIR_ID,
        "CONTEXT.json",
      ),
      "utf8",
    ).then(parseJsonRecord);
    expect(contextRecord.selected_section_anchors).toEqual(["risk"]);
    expect(contextRecord.selected_section_hashes).toEqual([
      createSha256ContentHash(selectedMarkdown),
    ]);
    expect(contextRecord.sections).toEqual([
      expect.objectContaining({
        anchor: "risk",
        markdown: selectedMarkdown,
        title: "Risk",
      }),
    ]);
    expect(JSON.stringify(contextRecord)).not.toContain("Appendix");
    expect(JSON.stringify(contextRecord)).not.toContain("irrelevant irrelevant");
  });

  it("maps user-approved web source permission to a network-enabled turn", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-web-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new FakeConversationClient("Cited answer.", [
      {
        sourceId: "../unsafe",
        title: "  Current release notes\nhidden  ",
        url: "https://example.com/releases?token=secret",
      },
      {
        sourceId: "drop-local",
        title: "Local file",
        url: "file:///private/tmp/secret",
      },
    ]);
    const handler = createSendPsychiatristMessageHandler({
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });

    await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({
            message: "Find the current source.",
            web_source_permission: "allow_for_this_turn",
          }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(client.inputs[0]).toMatchObject({
      networkAccess: "user_approved_web_sources",
    });
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]?.assistant?.citations).toEqual([
      {
        sourceId: "source-1",
        title: "Current release notes hidden",
        url: "https://example.com/releases",
      },
    ]);
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl"),
        "utf8",
      ).then((content) => content.trim().split("\n").map((line) => JSON.parse(line))),
    ).resolves.toContainEqual(
      expect.objectContaining({
        pair_id: PAIR_ID,
        status: "completed",
        web_source_policy: {
          allowed: true,
          reason: "user_approved_for_turn",
        },
      }),
    );
  });

  it("stores a network permission required turn without assistant response", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-network-required-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new WebSourceRequiredClient();
    const handler = createSendPsychiatristMessageHandler({
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({
            message: "Do I need current release notes?",
            web_source_permission: "deny",
          }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(202);
    expect(client.inputs[0]).toMatchObject({ networkAccess: "disabled" });
    await waitFor(async () => {
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      });
      return replay.some((event) => event.type === "psychiatrist.network.permission_required");
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        pairId: PAIR_ID,
        retryAction: "allow_web_sources",
        retryMode: "first_answer",
        retryTurnId: TURN_ID,
        status: "failed",
        turnId: TURN_ID,
      }),
    ]);
    expect(loaded.pairs[0]?.assistant).toBeUndefined();
    const threadResponse = await createReadPsychiatristThreadHandler({
      config: { storePath },
    })(
      createApiEvent(
        new Request(
          `http://localhost/api/memories/${MEMORY_ID}/psychiatrist/threads/${THREAD_ID}?variant_kind=source`,
        ),
        { memoryId: MEMORY_ID, threadId: THREAD_ID },
      ),
    );
    expect(threadResponse.status).toBe(200);
    await expect(threadResponse.json()).resolves.toMatchObject({
      pairs: [
        {
          pair_id: PAIR_ID,
          retry_action: "allow_web_sources",
          retry_mode: "first_answer",
          retry_turn_id: TURN_ID,
          status: "failed",
          turn_id: TURN_ID,
        },
      ],
    });
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          code: "network_permission_required",
          message: "Allow web-source access to answer this request.",
          pair_id: PAIR_ID,
          retry_action: "allow_web_sources",
          retry_mode: "first_answer",
          retry_turn_id: TURN_ID,
        }),
        type: "psychiatrist.network.permission_required",
      }),
    );

    const retryTurnId = EXTRA_TURN_IDS[0]!;
    const retryClient = new FakeConversationClient("Approved source answer.");
    const retryHandler = createRegeneratePsychiatristResponseHandler({
      client: retryClient,
      config: config(storePath),
      generateId: createIdGenerator([retryTurnId]),
    });

    const retryResponse = await retryHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody({ webSourcePermission: "allow_for_this_turn" }),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(retryResponse.status).toBe(202);
    await waitFor(() => retryClient.inputs.length === 1);
    expect(retryClient.inputs[0]).toMatchObject({
      cwdPurpose: "psychiatrist",
      networkAccess: "user_approved_web_sources",
    });
    expect(String(retryClient.inputs[0]?.input)).not.toContain("Regenerate metadata JSON");
    await waitFor(async () => {
      const reloaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return reloaded.pairs[0]?.status === "completed";
    });
    const retried = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(retried.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({ content: "Approved source answer." }),
        pairId: PAIR_ID,
        status: "completed",
        turnId: retryTurnId,
      }),
    ]);
  });

  it("records approved first-answer retry failures as normal failed turns", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-retry-fail-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      client: new WebSourceRequiredClient(),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({
            message: "Do I need current release notes?",
            web_source_permission: "deny",
          }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "failed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });

    const retryTurnId = EXTRA_TURN_IDS[0]!;
    const retryHandler = createRegeneratePsychiatristResponseHandler({
      client: new FailingConversationClient(),
      config: config(storePath),
      generateId: createIdGenerator([retryTurnId]),
    });

    const retryResponse = await retryHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody({ webSourcePermission: "allow_for_this_turn" }),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(retryResponse.status).toBe(202);
    await waitFor(async () => {
      const turnRecord = await readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${retryTurnId}.json`),
        "utf8",
      ).then((content) => JSON.parse(content));
      return turnRecord.status === "failed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    const retried = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(retried.pairs).toEqual([
      expect.objectContaining({
        pairId: PAIR_ID,
        status: "failed",
        turnId: retryTurnId,
      }),
    ]);
    expect(retried.pairs[0]?.assistant).toBeUndefined();
    const turnRecord = await readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${retryTurnId}.json`),
      "utf8",
    ).then((content) => JSON.parse(content));
    expect(turnRecord).toMatchObject({
      pair_id: PAIR_ID,
      safe_error: {
        action: "retry",
        code: "unknown",
        message: "Psychiatrist answer failed.",
      },
      status: "failed",
      thread_id: THREAD_ID,
      turn_id: retryTurnId,
    });
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: retryTurnId,
    });
    const failedEvent = replay.find((event) => event.type === "psychiatrist.answer.failed");
    expect(failedEvent).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          code: "unknown",
          message: "Psychiatrist answer failed.",
          pair_id: PAIR_ID,
        }),
        type: "psychiatrist.answer.failed",
      }),
    );
    expect(failedEvent?.data).not.toMatchObject({ retry_action: "regenerate" });
    expect(JSON.stringify(replay)).not.toContain("/private/");
    expect(JSON.stringify(replay)).not.toContain("token");
  });

  it("keeps a completed answer when backup enqueue fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-backup-fail-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const handler = createSendPsychiatristMessageHandler({
      backupQueue: {
        enqueue: async () => {
          throw new Error("backup unavailable");
        },
        persistIntent: async () => ({ backupStatus: "pending" }),
      },
      client: new FakeConversationClient("Completed despite backup failure."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What is the answer?" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      });
      return loaded.pairs[0]?.assistant?.content === "Completed despite backup failure." &&
        replay.some((event) => event.type === "psychiatrist.answer.completed");
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({
          content: "Completed despite backup failure.",
        }),
        pairId: PAIR_ID,
        status: "completed",
      }),
    ]);
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.filter((event) => event.type === "psychiatrist.answer.completed"))
      .toHaveLength(1);
    expect(replay).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          warning: {
            code: "backup_enqueue_failed",
            message: "Psychiatrist answer was saved, but backup enqueue failed.",
          },
        }),
        type: "psychiatrist.answer.completed",
      }),
    );
    expect(JSON.stringify(replay)).not.toContain("backup unavailable");
    expect(JSON.stringify(replay)).not.toContain(storePath);
  });

  it("keeps a completed answer and enqueues backup when THREAD.md refresh fails after save", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-thread-refresh-fail-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const backupEnqueues: unknown[] = [];
    const handler = createSendPsychiatristMessageHandler({
      appendAssistantResponse: async (input) => {
        await appendAssistantResponse(input);
        return { status: "completed", warning: "post_save_finalization_failed" };
      },
      backupQueue: {
        enqueue: async (input, finalizer) => {
          backupEnqueues.push(input);
          const result = { backupStatus: "queued" } as const;
          await finalizer?.(result);
          return result;
        },
        persistIntent: async () => ({ backupStatus: "pending" }),
      },
      client: new FakeConversationClient("Completed despite THREAD refresh failure."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What is the answer?" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      });
      return loaded.pairs[0]?.assistant?.content === "Completed despite THREAD refresh failure." &&
        replay.some((event) => event.type === "psychiatrist.answer.completed") &&
        backupEnqueues.length === 1;
    });
    await expect(
      readFile(join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`), "utf8")
        .then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      completed_at: expect.any(String),
      status: "completed",
      turn_id: TURN_ID,
    });
    expect(backupEnqueues).toEqual([
      expect.objectContaining({
        contentPaths: expect.arrayContaining([
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/THREAD.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/turns/${TURN_ID}.json`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/streams/${TURN_ID}.jsonl`,
        ]),
        memoryId: MEMORY_ID,
        reason: "psychiatrist_thread_update",
      }),
    ]);
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          warning: {
            code: "post_save_finalization_failed",
            message: "Psychiatrist answer was saved, but THREAD.md could not be refreshed.",
          },
        }),
        type: "psychiatrist.answer.completed",
      }),
    );
    expect(JSON.stringify(replay)).not.toContain(storePath);
  });

  it("marks accepted prompts failed without writing an assistant response when Codex fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-failed-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const handler = createSendPsychiatristMessageHandler({
      client: new FailingConversationClient(),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What failed?" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(async () => {
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      });
      return replay.some((event) => event.type === "psychiatrist.answer.failed");
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        pairId: PAIR_ID,
        status: "failed",
        turnId: TURN_ID,
        user: expect.objectContaining({ content: "What failed?" }),
      }),
    ]);
    expect(loaded.pairs[0]?.assistant).toBeUndefined();
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      pair_id: PAIR_ID,
      policy_version: PSYCHIATRIST_PROMPT_POLICY_VERSION,
      safe_error: {
        action: "retry",
        code: "unknown",
        message: "Psychiatrist answer failed.",
      },
      status: "failed",
      thread_id: THREAD_ID,
      turn_id: TURN_ID,
    });
  });

  it("fails an oversized final answer before publishing RESPONSE.md", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-final-limit-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const handler = createSendPsychiatristMessageHandler({
      client: new FakeConversationClient("界界界"),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
      limits: tinyTurnLimits({ maxFinalAnswerBytes: 8 }),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Return a bounded answer." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(() => activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined);
    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect(loaded.pairs[0]).toMatchObject({ status: "failed" });
    expect(loaded.pairs[0]?.assistant).toBeUndefined();
    await expect(readFile(
      join(
        storePath,
        "memories",
        MEMORY_ID,
        "threads",
        THREAD_ID,
        "pairs",
        PAIR_ID,
        "RESPONSE.md",
      ),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.at(-1)).toMatchObject({
      data: { code: "event_limit_exceeded" },
      type: "psychiatrist.answer.failed",
    });
  });

  it("drains rejected event persistence before terminalizing a failed message turn", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-event-failed-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new LateEventFailingConversationClient();
    const deltaWrite = createDeferred<void>();
    const writes: string[] = [];
    let statusSeenByTerminalWrite: string | undefined;
    const handler = createSendPsychiatristMessageHandler({
      appendStreamEvent: async (input) => {
        writes.push(input.event.type);
        if (input.event.type === "psychiatrist.answer.delta") {
          await deltaWrite.promise;
          return undefined;
        }
        if (input.event.type === "psychiatrist.answer.failed") {
          const loaded = await loadPsychiatristThread({
            config: { storePath },
            threadId: THREAD_ID,
          });
          statusSeenByTerminalWrite = loaded.pairs[0]?.status;
        }
        return appendPsychiatristStreamEvent(input);
      },
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Fail after a persisted delta." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(() => writes.includes("psychiatrist.answer.delta"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).not.toContain("psychiatrist.answer.failed");

    deltaWrite.reject(new Error("stream persistence unavailable"));
    await waitFor(() => activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined);
    expect(writes).toEqual([
      "psychiatrist.turn.started",
      "psychiatrist.answer.delta",
      "psychiatrist.answer.failed",
    ]);
    expect(statusSeenByTerminalWrite).toBe("failed");

    client.emitLateDelta();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toHaveLength(3);
  });

  it("marks stale threads and blocks Codex execution before accepting a message", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-stale-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new FakeConversationClient("must not run");
    const handler = createSendPsychiatristMessageHandler({
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
      resolveActiveContentHash: async () => "sha256:changed",
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({
            message: "What is current?",
            web_source_permission: "deny",
          }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      action: "refresh_thread",
      code: "thread_stale",
      message: "Psychiatrist thread is stale. Refresh the thread and retry.",
      status: "error",
    });
    expect(client.inputs).toEqual([]);
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.manifest.status).toBe("stale");
    expect(loaded.pairs).toEqual([]);
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.thread.stale",
    ]);
    expect(JSON.stringify(replay)).not.toContain("What is current?");
  });

  it("rejects an older prompt-policy thread before accepting any turn side effects", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-policy-stale-"));
    const threadDirectory = join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID);
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({ policyVersion: "psychiatrist-memory-pairs-old" }),
    });
    const threadMarkdownBefore = await readFile(join(threadDirectory, "THREAD.md"), "utf8");
    const calls: string[] = [];
    const client = new FakeConversationClient("must not run");
    const handler = createSendPsychiatristMessageHandler({
      appendAssistantResponse: async () => {
        calls.push("append assistant response");
        return { status: "completed" };
      },
      appendStreamEvent: async () => {
        calls.push("append stream event");
        return undefined;
      },
      backupQueue: {
        enqueue: async () => {
          calls.push("enqueue backup");
          return { backupStatus: "queued" };
        },
        persistIntent: async () => {
          calls.push("persist backup intent");
          return { backupStatus: "pending" };
        },
      },
      buildContext: async () => {
        calls.push("build context");
        return context();
      },
      client,
      config: { storePath },
      generateId: () => {
        calls.push("generate id");
        return PAIR_ID;
      },
      resolveActiveContentHash: async () => {
        calls.push("resolve active content hash");
        return "sha256:context";
      },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Use the current policy." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      action: "refresh_thread",
      code: "thread_stale",
      message: "Psychiatrist thread is stale. Refresh the thread and retry.",
      status: "error",
    });
    expect(calls).toEqual([]);
    expect(client.inputs).toEqual([]);
    expect(activePsychiatristTurns.hasActiveOrReservedThread(THREAD_ID)).toBe(false);
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.manifest).toMatchObject({
      policyVersion: "psychiatrist-memory-pairs-old",
      status: "stale",
    });
    expect(loaded.pairs).toEqual([]);
    await expect(readFile(join(threadDirectory, "THREAD.md"), "utf8")).resolves.toBe(
      threadMarkdownBefore,
    );
    await expect(readFile(join(threadDirectory, "PAIRS.jsonl"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(threadDirectory, "pairs", PAIR_ID, "CONTEXT.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(threadDirectory, "turns", `${TURN_ID}.json`), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(threadDirectory, "streams", `${TURN_ID}.jsonl`), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("marks stale threads when the loaded source hash changed", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-context-stale-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new FakeConversationClient("must not run");
    const handler = createSendPsychiatristMessageHandler({
      buildContext: async () => context({
        contentHash: "sha256:changed",
        sourceHash: "sha256:changed",
      }),
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What is current?" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      action: "refresh_thread",
      code: "thread_stale",
    });
    expect(client.inputs).toEqual([]);
  });

  it("returns a safe error when message context refresh is unavailable", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-context-error-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new FakeConversationClient("must not run");
    const handler = createSendPsychiatristMessageHandler({
      buildContext: async () => {
        throw new PsychiatristContextError(
          "context_unavailable",
          `raw path ${storePath}/memories/${MEMORY_ID}/CONTENT.md`,
        );
      },
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What is current?" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      action: "retry",
      code: "context_unavailable",
      message: "Psychiatrist context is unavailable for this memory.",
      status: "error",
    });
    expect(JSON.stringify(body)).not.toContain(storePath);
    expect(client.inputs).toEqual([]);
    expect(activePsychiatristTurns.hasActiveOrReservedThread(THREAD_ID)).toBe(false);
  });

  it("continues to client setup when production runtime isolation is asserted", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-client-setup-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const previousEndpoint = process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT;
    const previousIsolation = process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV];
    process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT = "https://localhost:1234";
    process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV] =
      PSYCHIATRIST_RUNTIME_ISOLATION_ASSERTION;
    try {
      const handler = createSendPsychiatristMessageHandler({
        buildContext: async () => context(),
        config: { storePath },
        generateId: createIdGenerator([PAIR_ID, TURN_ID]),
      });

      const response = await handler(
        createApiEvent(
          new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
            body: JSON.stringify({ message: "What is current?" }),
            method: "POST",
          }),
          { threadId: THREAD_ID },
        ),
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        code: "setup_required",
      });
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      expect(loaded.pairs).toEqual([
        expect.objectContaining({
          pairId: PAIR_ID,
          status: "failed",
          turnId: TURN_ID,
        }),
      ]);
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      });
      expect(replay.map((event) => event.type)).toEqual([
        "psychiatrist.turn.started",
        "psychiatrist.answer.failed",
      ]);
      expect(replay[1]?.data).toMatchObject({
        code: "setup_required",
        pair_id: PAIR_ID,
      });
      await expect(
        readFile(
          join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
          "utf8",
        ).then((content) => JSON.parse(content)),
      ).resolves.toMatchObject({
        pair_id: PAIR_ID,
        safe_error: {
          code: "setup_required",
        },
        status: "failed",
        thread_id: THREAD_ID,
        turn_id: TURN_ID,
      });
      expect(activePsychiatristTurns.hasActiveOrReservedThread(THREAD_ID)).toBe(false);
    } finally {
      if (previousEndpoint === undefined) {
        delete process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT;
      } else {
        process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT = previousEndpoint;
      }
      if (previousIsolation === undefined) {
        delete process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV];
      } else {
        process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV] = previousIsolation;
      }
    }
  });

  it("fails closed before a production message turn when runtime isolation is unasserted", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-isolation-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const previousEndpoint = process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT;
    const previousIsolation = process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV];
    process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT = "https://localhost:1234";
    delete process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV];
    try {
      const handler = createSendPsychiatristMessageHandler({
        buildContext: async () => context(),
        config: { storePath },
        generateId: createIdGenerator([PAIR_ID, TURN_ID]),
      });

      const response = await handler(
        createApiEvent(
          new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
            body: JSON.stringify({ message: "What is current?" }),
            method: "POST",
          }),
          { threadId: THREAD_ID },
        ),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        action: "retry",
        code: "runtime_isolation_required",
        message: "Psychiatrist requires an externally isolated Codex runtime.",
        status: "error",
      });
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      expect(loaded.pairs).toEqual([]);
      expect(activePsychiatristTurns.hasActiveOrReservedThread(THREAD_ID)).toBe(false);
    } finally {
      if (previousEndpoint === undefined) {
        delete process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT;
      } else {
        process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT = previousEndpoint;
      }
      if (previousIsolation === undefined) {
        delete process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV];
      } else {
        process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV] = previousIsolation;
      }
    }
  });

  it("fails closed before a production Regenerate lookup when runtime isolation is unasserted", async () => {
    const previousIsolation = process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV];
    delete process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV];
    try {
      const handler = createRegeneratePsychiatristResponseHandler();

      const response = await handler(
        createApiEvent(
          new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
            body: regenerateBody(),
            method: "POST",
          }),
          { pairId: PAIR_ID },
        ),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        action: "retry",
        code: "runtime_isolation_required",
        message: "Psychiatrist requires an externally isolated Codex runtime.",
        status: "error",
      });
    } finally {
      if (previousIsolation === undefined) {
        delete process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV];
      } else {
        process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV] = previousIsolation;
      }
    }
  });

  it("returns the safe message error when the persisted-pair failed event append fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-append-fail-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const previousEndpoint = process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT;
    const previousIsolation = process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV];
    process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT = "https://localhost:1234";
    process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV] =
      PSYCHIATRIST_RUNTIME_ISOLATION_ASSERTION;
    try {
      const handler = createSendPsychiatristMessageHandler({
        appendStreamEvent: async (input) => {
          if (input.event.type === "psychiatrist.answer.failed") {
            throw new Error("stream append failed");
          }
          return await appendPsychiatristStreamEvent(input);
        },
        buildContext: async () => context(),
        config: { storePath },
        generateId: createIdGenerator([PAIR_ID, TURN_ID]),
      });

      const response = await handler(
        createApiEvent(
          new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
            body: JSON.stringify({ message: "What is current?" }),
            method: "POST",
          }),
          { threadId: THREAD_ID },
        ),
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        action: "retry",
        code: "setup_required",
        status: "error",
      });
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      expect(loaded.pairs[0]).toMatchObject({
        pairId: PAIR_ID,
        status: "failed",
        turnId: TURN_ID,
      });
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      });
      expect(replay.map((event) => event.type)).toEqual(["psychiatrist.turn.started"]);
      expect(activePsychiatristTurns.hasActiveOrReservedThread(THREAD_ID)).toBe(false);
    } finally {
      if (previousEndpoint === undefined) {
        delete process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT;
      } else {
        process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT = previousEndpoint;
      }
      if (previousIsolation === undefined) {
        delete process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV];
      } else {
        process.env[PSYCHIATRIST_RUNTIME_ISOLATION_ENV] = previousIsolation;
      }
    }
  });

  it("rejects empty and oversized messages", async () => {
    const handler = createSendPsychiatristMessageHandler({
      client: new FakeConversationClient("unused"),
      config: { storePath: "/tmp/store" },
    });

    const empty = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "   " }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    const oversized = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "x".repeat(4001) }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toMatchObject({
      code: "invalid_request",
      message: "message must be a non-empty string.",
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({
      code: "invalid_request",
      message: "message must be 4000 characters or fewer.",
    });
  });

  it("rejects a second active turn for the same thread", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-conflict-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const handler = createSendPsychiatristMessageHandler({
      client: new HangingConversationClient(),
      config: { storePath },
      generateId: createIdGenerator([
        PAIR_ID,
        TURN_ID,
        "019e8a00-0000-7000-8000-000000000004",
        "019e8a00-0000-7000-8000-000000000005",
      ]),
    });

    const first = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "First" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    expect(first.status).toBe(202);
    const second = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Second" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      code: "turn_conflict",
    });
  });

  it("rejects a different-thread message at global capacity before client creation", async () => {
    const activeTurns = new ActivePsychiatristTurnRegistry(1);
    expect(activeTurns.tryReserveThread("other-thread")).toBe("reserved");
    let clientCreations = 0;
    const handler = createSendPsychiatristMessageHandler({
      activeTurns,
      config: { storePath: "/tmp/unused-psychiatrist-capacity" },
      createClient: () => {
        clientCreations += 1;
        return new FakeConversationClient("unused");
      },
      loadThread: async () => ({ manifest: manifest(), pairs: [] }),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Over capacity" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toMatchObject({
      code: "turn_capacity_exceeded",
      status: "error",
    });
    expect(clientCreations).toBe(0);
    activeTurns.releaseThread("other-thread");
  });

  it("shares global capacity with Regenerate before client creation", async () => {
    const activeTurns = new ActivePsychiatristTurnRegistry(1);
    expect(activeTurns.tryReserveThread("other-thread")).toBe("reserved");
    let clientCreations = 0;
    const pair = {
      assistant: {
        citations: [],
        completedAt: "2026-06-01T00:00:00.000Z",
        content: "Prior answer",
      },
      pairId: PAIR_ID,
      status: "completed" as const,
      turnId: TURN_ID,
      user: {
        content: "Prior question",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    };
    const threadManifest = manifest();
    const regenerate = createRegeneratePsychiatristResponseHandler({
      activeTurns,
      config: config("/tmp/unused-psychiatrist-capacity"),
      createClient: () => {
        clientCreations += 1;
        return new FakeConversationClient("unused");
      },
      loadPair: async () => ({
        contextSnapshot: {
          ...context(),
          contextSnapshotId: PAIR_ID,
          policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
          selectedSectionAnchors: [],
          selectedSectionHashes: [],
          userPrompt: pair.user.content,
        },
        manifest: threadManifest,
        pair,
        paths: {
          pairContextRelativePath: "unused/CONTEXT.json",
          pairPromptRelativePath: "unused/PROMPT.md",
          pairResponseRelativePath: "unused/RESPONSE.md",
          pairRevisionLogRelativePath: "unused/PAIRS.jsonl",
          threadManifestRelativePath: "unused/THREAD.json",
          threadMarkdownRelativePath: "unused/THREAD.md",
        },
        prompt: pair.user.content,
        thread: { manifest: threadManifest, pairs: [pair] },
      }),
    });

    const response = await regenerate(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toMatchObject({
      code: "turn_capacity_exceeded",
      status: "error",
    });
    expect(clientCreations).toBe(0);
    activeTurns.releaseThread("other-thread");
  });

  it("cancels only an explicitly requested active turn", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-cancel-"));
    const client = new CancelTrackingClient();
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Stop this turn." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    activePsychiatristTurns.updateCodexIds({
      codexThreadId: "codex-thread-1",
      codexTurnId: "codex-turn-1",
      turnId: TURN_ID,
    });
    const handler = createCancelPsychiatristTurnHandler({
      activeTurns: activePsychiatristTurns,
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/cancel`, {
          body: JSON.stringify({
            memory_id: MEMORY_ID,
            pair_id: PAIR_ID,
            thread_id: THREAD_ID,
          }),
          method: "POST",
        }),
        { turnId: TURN_ID },
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "canceled",
      turn_id: TURN_ID,
    });
    expect(client.cancelCalls).toEqual([
      { threadId: "codex-thread-1", turnId: "codex-turn-1" },
    ]);
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        pairId: PAIR_ID,
        status: "canceled",
        turnId: TURN_ID,
        user: expect.objectContaining({ content: "Stop this turn." }),
      }),
    ]);
    expect(loaded.pairs[0]?.assistant).toBeUndefined();
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      pair_id: PAIR_ID,
      policy_version: PSYCHIATRIST_PROMPT_POLICY_VERSION,
      status: "canceled",
      thread_id: THREAD_ID,
      turn_id: TURN_ID,
    });
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.turn.started",
      "psychiatrist.turn.canceled",
    ]);
  });

  it("does not emit failed events when a canceled turn wins before a later runtime failure", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-cancel-wins-failure-"));
    const client = new ControlledFailingConversationClient();
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    const start = await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Stop before failure." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    expect(start.status).toBe(202);
    await waitFor(() => activePsychiatristTurns.getByTurnId(TURN_ID) !== undefined);
    const cancelHandler = createCancelPsychiatristTurnHandler({
      activeTurns: activePsychiatristTurns,
      config: { storePath },
    });
    const canceled = await cancelHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/cancel`, {
          body: cancelBody(),
          method: "POST",
        }),
        { turnId: TURN_ID },
      ),
    );
    expect(canceled.status).toBe(202);

    client.fail();
    await waitFor(() => activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined);
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.turn.started",
      "psychiatrist.turn.canceled",
    ]);
  });

  it("does not cancel or emit canceled events for already completed turns", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-cancel-completed-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      client: new FakeConversationClient("Completed before stale Stop."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "This finishes before Stop." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    const cancelClient = new CancelTrackingClient();
    activePsychiatristTurns.register({
      client: cancelClient,
      codexThreadId: "codex-thread-1",
      codexTurnId: "codex-turn-1",
      memoryId: MEMORY_ID,
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const handler = createCancelPsychiatristTurnHandler({
      activeTurns: activePsychiatristTurns,
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/cancel`, {
          body: cancelBody(),
          method: "POST",
        }),
        { turnId: TURN_ID },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "completed",
      turn_id: TURN_ID,
    });
    expect(cancelClient.cancelCalls).toEqual([]);
    expect(activePsychiatristTurns.getByTurnId(TURN_ID)).toBeUndefined();
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      assistant: expect.objectContaining({ content: "Completed before stale Stop." }),
      pairId: PAIR_ID,
      status: "completed",
      turnId: TURN_ID,
    });
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.turn.started",
      "psychiatrist.process.delta",
      "psychiatrist.answer.delta",
      "psychiatrist.answer.completed",
    ]);
  });

  it("defers local cancel while Codex ids are not ready", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-cancel-not-ready-"));
    const client = new NoCodexIdsCancelTrackingClient();
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Stop this turn early." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    const handler = createCancelPsychiatristTurnHandler({
      activeTurns: activePsychiatristTurns,
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/cancel`, {
          body: cancelBody(),
          method: "POST",
        }),
        { turnId: TURN_ID },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "turn_not_ready",
    });
    expect(client.cancelCalls).toEqual([]);
    expect(activePsychiatristTurns.getByTurnId(TURN_ID)).toBeDefined();
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      pairId: PAIR_ID,
      status: "pending",
      turnId: TURN_ID,
    });
  });

  it("ignores legacy stored Codex thread ids and cancels only the active runtime turn", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-cancel-legacy-codex-"));
    const client = new CancelTrackingClient();
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const manifestPath = join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.json");
    const manifestJson = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifestJson, codex_thread_id: "codex-thread-legacy" }, null, 2),
      "utf8",
    );
    const sendHandler = createSendPsychiatristMessageHandler({
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Stop reused thread." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(() =>
      activePsychiatristTurns.getByTurnId(TURN_ID)?.codexTurnId === "codex-turn-1"
    );
    const handler = createCancelPsychiatristTurnHandler({
      activeTurns: activePsychiatristTurns,
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/cancel`, {
          body: cancelBody(),
          method: "POST",
        }),
        { turnId: TURN_ID },
      ),
    );

    expect(response.status).toBe(202);
    expect(client.cancelCalls).toEqual([
      { threadId: "codex-thread-1", turnId: "codex-turn-1" },
    ]);
  });

  it("releases local turn state when Codex interrupt fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-cancel-interrupt-fail-"));
    const client = new FailingCancelTrackingClient();
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Stop even if Codex rejects interrupt." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(() =>
      activePsychiatristTurns.getByTurnId(TURN_ID)?.codexTurnId === "codex-turn-1"
    );
    const handler = createCancelPsychiatristTurnHandler({
      activeTurns: activePsychiatristTurns,
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/cancel`, {
          body: cancelBody(),
          method: "POST",
        }),
        { turnId: TURN_ID },
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "canceled",
      turn_id: TURN_ID,
      warning: { code: "codex_interrupt_failed" },
    });
    expect(client.cancelCalls).toEqual([
      { threadId: "codex-thread-1", turnId: "codex-turn-1" },
    ]);
    expect(activePsychiatristTurns.getByTurnId(TURN_ID)).toBeUndefined();
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      pairId: PAIR_ID,
      status: "canceled",
      turnId: TURN_ID,
    });
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "canceled",
          warning: { code: "codex_interrupt_failed", message: expect.any(String) },
        }),
        type: "psychiatrist.turn.canceled",
      }),
    );
  });

  it("unregisters canceled turns and returns safe status when cancel stream append fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-cancel-append-fail-"));
    const client = new CancelTrackingClient();
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      client,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Stop despite append failure." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    activePsychiatristTurns.updateCodexIds({
      codexThreadId: "codex-thread-1",
      codexTurnId: "codex-turn-1",
      turnId: TURN_ID,
    });
    const handler = createCancelPsychiatristTurnHandler({
      activeTurns: activePsychiatristTurns,
      appendStreamEvent: async () => {
        throw new Error("stream append failed");
      },
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/cancel`, {
          body: cancelBody(),
          method: "POST",
        }),
        { turnId: TURN_ID },
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "canceled",
      turn_id: TURN_ID,
    });
    expect(activePsychiatristTurns.getByTurnId(TURN_ID)).toBeUndefined();
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      pairId: PAIR_ID,
      status: "canceled",
      turnId: TURN_ID,
    });
    const replayResponse = await createPsychiatristTurnEventsHandler({
      config: { storePath },
    })(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`),
        { turnId: TURN_ID },
      ),
    );
    expect(await replayResponse.text()).toContain("event: psychiatrist.turn.canceled");
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.filter((event) => event.type === "psychiatrist.turn.canceled"))
      .toHaveLength(1);
  });

  it("rejects cancel requests whose variant scope does not match the active turn", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-cancel-scope-"));
    const client = new CancelTrackingClient();
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    activePsychiatristTurns.register({
      client,
      codexThreadId: "codex-thread-1",
      codexTurnId: "codex-turn-1",
      memoryId: MEMORY_ID,
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const handler = createCancelPsychiatristTurnHandler({
      activeTurns: activePsychiatristTurns,
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/cancel`, {
          body: cancelBody({ langCode: "ja-JP", variantKind: "translation" }),
          method: "POST",
        }),
        { turnId: TURN_ID },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "turn_scope_mismatch",
      status: "error",
    });
    expect(client.cancelCalls).toEqual([]);
    expect(activePsychiatristTurns.getByTurnId(TURN_ID)).toBeDefined();
  });

  it("rejects malformed legacy cancel scope fields", async () => {
    const handler = createCancelPsychiatristTurnHandler({
      activeTurns: activePsychiatristTurns,
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/cancel`, {
          body: JSON.stringify({
            memory_id: MEMORY_ID,
            pair_id: PAIR_ID,
            thread_id: THREAD_ID,
            variant_kind: "",
          }),
          method: "POST",
        }),
        { turnId: TURN_ID },
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_request",
      message: "variant_kind must be source or translation.",
    });
  });

  it("regenerates a completed pair by reusing prompt context and overwriting the response artifact", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendClient = new FakeConversationClient("Original answer.");
    const sendHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: sendClient,
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What changed?", web_source_permission: "deny" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });

    const backupEnqueues: unknown[] = [];
    const enqueueReplayTypes: Array<{ phase: "before_finalizer" | "after_finalizer"; types: string[] }> = [];
    const regenerateIntentStates: Array<{
      response: string;
      terminalVisible: boolean;
    }> = [];
    const regenerateTurnId = "019e8a00-0000-7000-8000-000000000004";
    const regenerateClient = new FakeConversationClient("Regenerated answer.");
    const regenerateHandler = createRegeneratePsychiatristResponseHandler({
      backupQueue: {
        enqueue: async (input, finalizer) => {
          const replayBeforeFinalizer = await loadPsychiatristStreamReplay({
            config: { storePath },
            memoryId: MEMORY_ID,
            threadId: THREAD_ID,
            turnId: regenerateTurnId,
          });
          enqueueReplayTypes.push({
            phase: "before_finalizer",
            types: replayBeforeFinalizer.map((event) => event.type),
          });
          backupEnqueues.push(input);
          const result = { backupStatus: "queued" } as const;
          await finalizer?.(result);
          const replayAfterFinalizer = await loadPsychiatristStreamReplay({
            config: { storePath },
            memoryId: MEMORY_ID,
            threadId: THREAD_ID,
            turnId: regenerateTurnId,
          });
          enqueueReplayTypes.push({
            phase: "after_finalizer",
            types: replayAfterFinalizer.map((event) => event.type),
          });
          return result;
        },
        persistIntent: async () => {
          const replay = await loadPsychiatristStreamReplay({
            config: { storePath },
            memoryId: MEMORY_ID,
            threadId: THREAD_ID,
            turnId: regenerateTurnId,
          });
          regenerateIntentStates.push({
            response: await readFile(
              join(
                storePath,
                "memories",
                MEMORY_ID,
                "threads",
                THREAD_ID,
                "pairs",
                PAIR_ID,
                "RESPONSE.md",
              ),
              "utf8",
            ),
            terminalVisible: replay.some((event) =>
              event.type === "psychiatrist.regenerate.completed"
            ),
          });
          return { backupStatus: "pending" };
        },
      },
      client: regenerateClient,
      config: config(storePath),
      generateId: createIdGenerator([regenerateTurnId]),
    });

    const response = await regenerateHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: JSON.stringify({
            memory_id: MEMORY_ID,
            thread_id: THREAD_ID,
            web_source_permission: "deny",
          }),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      event_url: psychiatristEventsUrl(regenerateTurnId),
      pair_id: PAIR_ID,
      replay_url: psychiatristEventsUrl(regenerateTurnId),
      status: "started",
      thread_id: THREAD_ID,
      turn_id: regenerateTurnId,
    });
    await waitFor(() => regenerateClient.inputs.length === 1);
    expect(regenerateClient.inputs[0]).toMatchObject({
      cwdPurpose: "psychiatrist",
      networkAccess: "disabled",
    });
    expect(regenerateClient.inputs[0]?.threadId).toBeUndefined();
    const regeneratePrompt = String(regenerateClient.inputs[0]?.input);
    expect(regeneratePrompt).toContain('"reason":"user_requested_regenerate"');
    expect(regeneratePrompt).toContain("What changed?");
    expect(regeneratePrompt).toContain("Raw markdown");
    expect(regeneratePrompt).toContain("Memory");
    expect(regeneratePrompt).toContain("https://example.com/memory");

    await waitFor(async () => {
      const content = await readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "pairs",
          PAIR_ID,
          "RESPONSE.md",
        ),
        "utf8",
      );
      return content === "Regenerated answer." && backupEnqueues.length === 1;
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({ content: "Regenerated answer." }),
        pairId: PAIR_ID,
        status: "completed",
        turnId: regenerateTurnId,
      }),
    ]);
    await expect(
      readFile(join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.md"), "utf8"),
    ).resolves.toContain("Regenerated answer.");
    expect(backupEnqueues).toEqual([
      {
        contentPaths: [
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/THREAD.json`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/THREAD.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/pairs/${PAIR_ID}/PROMPT.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/pairs/${PAIR_ID}/CONTEXT.json`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/pairs/${PAIR_ID}/RESPONSE.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/PAIRS.jsonl`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/turns/${regenerateTurnId}.json`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/streams/${regenerateTurnId}.jsonl`,
        ],
        memoryId: MEMORY_ID,
        reason: "psychiatrist_response_regenerate",
      },
    ]);
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.regenerate.started",
      "psychiatrist.process.delta",
      "psychiatrist.answer.delta",
      "psychiatrist.regenerate.completed",
    ]);
    expect(replay[3]?.data).toMatchObject({
      pair_id: PAIR_ID,
      text: "Regenerated answer.",
    });
    expect(enqueueReplayTypes).toEqual([
      {
        phase: "before_finalizer",
        types: [
          "psychiatrist.regenerate.started",
          "psychiatrist.process.delta",
          "psychiatrist.answer.delta",
        ],
      },
      {
        phase: "after_finalizer",
        types: [
          "psychiatrist.regenerate.started",
          "psychiatrist.process.delta",
          "psychiatrist.answer.delta",
          "psychiatrist.regenerate.completed",
        ],
      },
    ]);
    expect(regenerateIntentStates).toEqual([{
      response: "Original answer.",
      terminalVisible: false,
    }]);
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl"),
        "utf8",
      ).then((content) => content.trim().split("\n").map((line) => JSON.parse(line))),
    ).resolves.toContainEqual(
      expect.objectContaining({
        pair_id: PAIR_ID,
        regenerated_from_turn_id: TURN_ID,
        status: "completed",
        stream_path: `memories/${MEMORY_ID}/threads/${THREAD_ID}/streams/${regenerateTurnId}.jsonl`,
        turn_id: regenerateTurnId,
      }),
    );
    await expect(
      readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "turns",
          `${regenerateTurnId}.json`,
        ),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      completed_at: expect.any(String),
      pair_id: PAIR_ID,
      regenerate_from_turn_id: TURN_ID,
      started_at: expect.any(String),
      status: "completed",
      thread_id: THREAD_ID,
      turn_id: regenerateTurnId,
    });
  });

  it("rejects regenerate requests whose variant scope does not match the stored pair", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-scope-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What changed?" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    const before = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    const regenerateClient = new FakeConversationClient("must not run");
    const regenerate = createRegeneratePsychiatristResponseHandler({
      client: regenerateClient,
      config: config(storePath),
      generateId: createIdGenerator([EXTRA_TURN_IDS[0]!]),
    });

    const response = await regenerate(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody({ langCode: "ja-JP", variantKind: "translation" }),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "regenerate_unavailable",
      status: "error",
    });
    expect(regenerateClient.inputs).toEqual([]);
    await expect(loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    })).resolves.toEqual(before);
  });

  it("rejects malformed legacy regenerate scope fields", async () => {
    const regenerate = createRegeneratePsychiatristResponseHandler({
      config: config("/tmp/store"),
    });

    const response = await regenerate(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: JSON.stringify({
            memory_id: MEMORY_ID,
            thread_id: THREAD_ID,
            variant_kind: "translated",
          }),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_request",
      message: "variant_kind must be source or translation.",
    });
  });

  it("excludes later Q/A pairs when regenerating an older completed pair", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-history-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const priorPairId = PAIR_ID;
    const priorTurnId = TURN_ID;
    const targetPairId = EXTRA_TURN_IDS[0]!;
    const targetTurnId = EXTRA_TURN_IDS[1]!;
    const laterPairId = "019e8a00-0000-7000-8000-000000000008";
    const laterTurnId = "019e8a00-0000-7000-8000-000000000009";
    const priorHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Prior answer for history."),
      config: { storePath },
      generateId: createIdGenerator([priorPairId, priorTurnId]),
    });
    await priorHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Prior question for history." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });

    const targetHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Original target answer."),
      config: { storePath },
      generateId: createIdGenerator([targetPairId, targetTurnId]),
    });
    await targetHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Target question to regenerate." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs.some((pair) =>
        pair.pairId === targetPairId && pair.status === "completed"
      ) && activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });

    const laterHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Later answer must be hidden."),
      config: { storePath },
      generateId: createIdGenerator([laterPairId, laterTurnId]),
    });
    await laterHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Later question must be hidden." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs.some((pair) =>
        pair.pairId === laterPairId && pair.status === "completed"
      ) && activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });

    const regenerateTurnId = "019e8a00-0000-7000-8000-000000000010";
    const regenerateClient = new FakeConversationClient("Regenerated target answer.");
    const regenerateHandler = createRegeneratePsychiatristResponseHandler({
      client: regenerateClient,
      config: config(storePath),
      generateId: createIdGenerator([regenerateTurnId]),
    });

    const response = await regenerateHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${targetPairId}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: targetPairId },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(() => regenerateClient.inputs.length === 1);
    const regeneratePrompt = String(regenerateClient.inputs[0]?.input);
    expect(regeneratePrompt).toContain("Prior question for history.");
    expect(regeneratePrompt).toContain("Prior answer for history.");
    expect(regeneratePrompt).toContain("Target question to regenerate.");
    expect(regeneratePrompt).not.toContain("Original target answer.");
    expect(regeneratePrompt).not.toContain("Later question must be hidden.");
    expect(regeneratePrompt).not.toContain("Later answer must be hidden.");
  });

  it("excludes later Q/A pairs when retrying an older failed first answer", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-answer-retry-history-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const priorPairId = PAIR_ID;
    const priorTurnId = TURN_ID;
    const failedPairId = EXTRA_TURN_IDS[0]!;
    const failedTurnId = EXTRA_TURN_IDS[1]!;
    const laterPairId = "019e8a00-0000-7000-8000-000000000008";
    const laterTurnId = "019e8a00-0000-7000-8000-000000000009";
    await createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Prior answer before failed retry."),
      config: { storePath },
      generateId: createIdGenerator([priorPairId, priorTurnId]),
    })(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Prior question before failed retry." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    await createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new WebSourceRequiredClient(),
      config: { storePath },
      generateId: createIdGenerator([failedPairId, failedTurnId]),
    })(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({
            message: "Failed question to retry.",
            web_source_permission: "deny",
          }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs.some((pair) =>
        pair.pairId === failedPairId && pair.status === "failed"
      ) && activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    await createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Later answer must be hidden from retry."),
      config: { storePath },
      generateId: createIdGenerator([laterPairId, laterTurnId]),
    })(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Later question must be hidden from retry." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs.some((pair) =>
        pair.pairId === laterPairId && pair.status === "completed"
      ) && activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    const retryTurnId = "019e8a00-0000-7000-8000-000000000010";
    const retryClient = new FakeConversationClient("Approved retry answer.");
    const retryHandler = createRegeneratePsychiatristResponseHandler({
      client: retryClient,
      config: config(storePath),
      generateId: createIdGenerator([retryTurnId]),
    });

    const response = await retryHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${failedPairId}/regenerate`, {
          body: regenerateBody({
            webSourcePermission: "allow_for_this_turn",
          }),
          method: "POST",
        }),
        { pairId: failedPairId },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(() => retryClient.inputs.length === 1);
    const retryPrompt = String(retryClient.inputs[0]?.input);
    expect(retryPrompt).toContain("Prior question before failed retry.");
    expect(retryPrompt).toContain("Prior answer before failed retry.");
    expect(retryPrompt).toContain("Failed question to retry.");
    expect(retryPrompt).not.toContain("Later question must be hidden from retry.");
    expect(retryPrompt).not.toContain("Later answer must be hidden from retry.");
  });

  it("does not emit failed events when a canceled regenerate wins before a later runtime failure", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-cancel-wins-failure-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Regenerate later." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    const regenerateTurnId = EXTRA_TURN_IDS[0]!;
    const client = new ControlledFailingConversationClient();
    const regenerate = createRegeneratePsychiatristResponseHandler({
      client,
      config: config(storePath),
      generateId: createIdGenerator([regenerateTurnId]),
    });
    const started = await regenerate(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );
    expect(started.status).toBe(202);
    await waitFor(() => activePsychiatristTurns.getByTurnId(regenerateTurnId) !== undefined);
    const cancelHandler = createCancelPsychiatristTurnHandler({
      activeTurns: activePsychiatristTurns,
      config: { storePath },
    });
    const canceled = await cancelHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${regenerateTurnId}/cancel`, {
          body: cancelBody(),
          method: "POST",
        }),
        { turnId: regenerateTurnId },
      ),
    );
    expect(canceled.status).toBe(202);

    client.fail();
    await waitFor(() => activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined);
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.regenerate.started",
      "psychiatrist.turn.canceled",
    ]);
  });

  it("starts approved first-answer retries from a fresh Codex thread", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-retry-fresh-thread-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const firstHandler = createSendPsychiatristMessageHandler({
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await firstHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "First answer." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });

    const failedPairId = EXTRA_TURN_IDS[0]!;
    const failedTurnId = EXTRA_TURN_IDS[1]!;
    const networkClient = new WebSourceRequiredClient();
    const secondHandler = createSendPsychiatristMessageHandler({
      client: networkClient,
      config: { storePath },
      generateId: createIdGenerator([failedPairId, failedTurnId]),
    });
    await secondHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({
            message: "Need current release notes?",
            web_source_permission: "deny",
          }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs.some((pair) => pair.pairId === failedPairId && pair.status === "failed") &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    expect(networkClient.inputs[0]?.threadId).toBeUndefined();

    const retryTurnId = "019e8a00-0000-7000-8000-000000000007";
    const retryClient = new FakeConversationClient("Approved source answer.");
    const retryHandler = createRegeneratePsychiatristResponseHandler({
      client: retryClient,
      config: config(storePath),
      generateId: createIdGenerator([retryTurnId]),
    });

    const retryResponse = await retryHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${failedPairId}/regenerate`, {
          body: regenerateBody({ webSourcePermission: "allow_for_this_turn" }),
          method: "POST",
        }),
        { pairId: failedPairId },
      ),
    );

    expect(retryResponse.status).toBe(202);
    await waitFor(() => retryClient.inputs.length === 1);
    expect(retryClient.inputs[0]).toMatchObject({
      cwdPurpose: "psychiatrist",
      networkAccess: "user_approved_web_sources",
    });
    expect(retryClient.inputs[0]?.threadId).toBeUndefined();
  });

  it("keeps regenerated answers completed when backup enqueue fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-backup-fail-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What changed?" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    const regenerateTurnId = EXTRA_TURN_IDS[0]!;
    const regenerateHandler = createRegeneratePsychiatristResponseHandler({
      backupQueue: {
        enqueue: async () => {
          throw new Error("backup unavailable");
        },
        persistIntent: async () => ({ backupStatus: "pending" }),
      },
      client: new FakeConversationClient("Regenerated despite backup failure."),
      config: config(storePath),
      generateId: createIdGenerator([regenerateTurnId]),
    });

    const response = await regenerateHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: regenerateTurnId,
      });
      return loaded.pairs[0]?.assistant?.content === "Regenerated despite backup failure." &&
        replay.some((event) => event.type === "psychiatrist.regenerate.completed");
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      assistant: expect.objectContaining({ content: "Regenerated despite backup failure." }),
      status: "completed",
      turnId: regenerateTurnId,
    });
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    expect(replay.filter((event) => event.type === "psychiatrist.regenerate.completed"))
      .toHaveLength(1);
    expect(replay).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          warning: {
            code: "backup_enqueue_failed",
            message: "Psychiatrist answer was saved, but backup enqueue failed.",
          },
        }),
        type: "psychiatrist.regenerate.completed",
      }),
    );
    expect(JSON.stringify(replay)).not.toContain("backup unavailable");
    expect(JSON.stringify(replay)).not.toContain(storePath);
  });

  it("keeps regenerated answers completed and enqueues backup when THREAD.md refresh fails after save", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-thread-refresh-fail-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What changed?" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    const backupEnqueues: unknown[] = [];
    const regenerateTurnId = EXTRA_TURN_IDS[0]!;
    const regenerateHandler = createRegeneratePsychiatristResponseHandler({
      appendRegeneratedAssistantResponse: async (input) => {
        await appendRegeneratedAssistantResponse(input);
        return { status: "completed", warning: "post_save_finalization_failed" };
      },
      backupQueue: {
        enqueue: async (input, finalizer) => {
          backupEnqueues.push(input);
          const result = { backupStatus: "queued" } as const;
          await finalizer?.(result);
          return result;
        },
        persistIntent: async () => ({ backupStatus: "pending" }),
      },
      client: new FakeConversationClient("Regenerated despite THREAD refresh failure."),
      config: config(storePath),
      generateId: createIdGenerator([regenerateTurnId]),
    });

    const response = await regenerateHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: regenerateTurnId,
      });
      return loaded.pairs[0]?.assistant?.content === "Regenerated despite THREAD refresh failure." &&
        replay.some((event) => event.type === "psychiatrist.regenerate.completed") &&
        backupEnqueues.length === 1;
    });
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${regenerateTurnId}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      completed_at: expect.any(String),
      regenerate_from_turn_id: TURN_ID,
      status: "completed",
      turn_id: regenerateTurnId,
    });
    expect(backupEnqueues).toEqual([
      expect.objectContaining({
        contentPaths: expect.arrayContaining([
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/THREAD.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/turns/${regenerateTurnId}.json`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/streams/${regenerateTurnId}.jsonl`,
        ]),
        memoryId: MEMORY_ID,
        reason: "psychiatrist_response_regenerate",
      }),
    ]);
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    expect(replay).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          warning: {
            code: "post_save_finalization_failed",
            message: "Psychiatrist answer was saved, but THREAD.md could not be refreshed.",
          },
        }),
        type: "psychiatrist.regenerate.completed",
      }),
    );
    expect(JSON.stringify(replay)).not.toContain(storePath);
  });

  it("requires web-source permission for regenerate before overwriting the completed answer", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-network-required-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Need current source?" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    const regenerateTurnId = EXTRA_TURN_IDS[0]!;
    const regenerateHandler = createRegeneratePsychiatristResponseHandler({
      client: new WebSourceRequiredClient(),
      config: config(storePath),
      generateId: createIdGenerator([regenerateTurnId]),
    });

    const response = await regenerateHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(async () => {
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: regenerateTurnId,
      });
      return replay.some((event) => event.type === "psychiatrist.network.permission_required");
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      assistant: expect.objectContaining({ content: "Original answer." }),
      retryAction: "allow_web_sources",
      retryMode: "regenerate",
      retryTurnId: regenerateTurnId,
      status: "completed",
      turnId: TURN_ID,
    });
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "pairs", PAIR_ID, "RESPONSE.md"),
        "utf8",
      ),
    ).resolves.toBe("Original answer.");
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    expect(replay).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          code: "network_permission_required",
          pair_id: PAIR_ID,
          retry_action: "allow_web_sources",
          retry_mode: "regenerate",
          retry_turn_id: regenerateTurnId,
          user_prompt: "Need current source?",
        }),
        type: "psychiatrist.network.permission_required",
      }),
    );

    const approvedRegenerateTurnId = EXTRA_TURN_IDS[1]!;
    const approvedRegenerateClient = new FakeConversationClient("Approved regenerated answer.");
    const approvedRegenerateHandler = createRegeneratePsychiatristResponseHandler({
      client: approvedRegenerateClient,
      config: config(storePath),
      generateId: createIdGenerator([approvedRegenerateTurnId]),
    });

    const approvedResponse = await approvedRegenerateHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody({ webSourcePermission: "allow_for_this_turn" }),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(approvedResponse.status).toBe(202);
    await waitFor(async () => {
      const reloaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return reloaded.pairs[0]?.assistant?.content === "Approved regenerated answer." &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    expect(approvedRegenerateClient.inputs[0]).toMatchObject({
      cwdPurpose: "psychiatrist",
      networkAccess: "user_approved_web_sources",
    });
    const reloaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(reloaded.pairs[0]).toMatchObject({
      assistant: expect.objectContaining({ content: "Approved regenerated answer." }),
      status: "completed",
      turnId: approvedRegenerateTurnId,
    });
    expect(reloaded.pairs[0]).not.toHaveProperty("retryAction");
    expect(reloaded.pairs[0]).not.toHaveProperty("retryMode");
    expect(reloaded.pairs[0]).not.toHaveProperty("retryTurnId");
  });

  it("keeps the previous completed answer visible when regenerate fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-fail-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What changed?", web_source_permission: "deny" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      });
      return loaded.pairs[0]?.status === "completed" &&
        replay.some((event) => event.type === "psychiatrist.answer.completed") &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });

    const regenerateTurnId = "019e8a00-0000-7000-8000-000000000004";
    const regenerateHandler = createRegeneratePsychiatristResponseHandler({
      client: new FailingConversationClient(),
      config: config(storePath),
      generateId: createIdGenerator([regenerateTurnId]),
    });

    const response = await regenerateHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(async () => {
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: regenerateTurnId,
      });
      return replay.some((event) => event.type === "psychiatrist.answer.failed");
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({ content: "Original answer." }),
        pairId: PAIR_ID,
        status: "completed",
        turnId: TURN_ID,
      }),
    ]);
    await expect(
      readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "pairs",
          PAIR_ID,
          "RESPONSE.md",
        ),
        "utf8",
      ),
    ).resolves.toBe("Original answer.");
    await expect(
      readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "turns",
          `${regenerateTurnId}.json`,
        ),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      pair_id: PAIR_ID,
      status: "failed",
      thread_id: THREAD_ID,
      turn_id: regenerateTurnId,
    });
  });

  it("drains rejected event persistence before terminalizing a failed regenerate turn", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-event-failed-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    })(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Regenerate this answer." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });

    const regenerateTurnId = EXTRA_TURN_IDS[0]!;
    const client = new LateEventFailingConversationClient();
    const deltaWrite = createDeferred<void>();
    const writes: string[] = [];
    let statusSeenByTerminalWrite: string | undefined;
    const handler = createRegeneratePsychiatristResponseHandler({
      appendStreamEvent: async (input) => {
        writes.push(input.event.type);
        if (input.event.type === "psychiatrist.answer.delta") {
          await deltaWrite.promise;
          return undefined;
        }
        if (input.event.type === "psychiatrist.answer.failed") {
          statusSeenByTerminalWrite = await readFile(
            join(
              storePath,
              "memories",
              MEMORY_ID,
              "threads",
              THREAD_ID,
              "turns",
              `${regenerateTurnId}.json`,
            ),
            "utf8",
          ).then((content) => JSON.parse(content).status as string);
        }
        return appendPsychiatristStreamEvent(input);
      },
      client,
      config: config(storePath),
      generateId: createIdGenerator([regenerateTurnId]),
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(() => writes.includes("psychiatrist.answer.delta"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).not.toContain("psychiatrist.answer.failed");

    deltaWrite.reject(new Error("stream persistence unavailable"));
    await waitFor(() => activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined);
    expect(writes).toEqual([
      "psychiatrist.regenerate.started",
      "psychiatrist.answer.delta",
      "psychiatrist.answer.failed",
    ]);
    expect(statusSeenByTerminalWrite).toBe("failed");

    client.emitLateDelta();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toHaveLength(3);
  });

  it("keeps the prior RESPONSE when regenerate event ingestion exceeds its turn limit", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-limit-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Original bounded answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    })(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Create an answer." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });

    const regenerateTurnId = EXTRA_TURN_IDS[0]!;
    const response = await createRegeneratePsychiatristResponseHandler({
      client: new BackpressureAwareFloodingClient(),
      config: config(storePath),
      generateId: createIdGenerator([regenerateTurnId]),
      limits: tinyTurnLimits({ maxTurnEvents: 1 }),
    })(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(202);
    await waitFor(() => activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined);
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      assistant: { content: "Original bounded answer." },
      status: "completed",
      turnId: TURN_ID,
    });
    const failedReplay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    expect(failedReplay.at(-1)).toMatchObject({
      data: { code: "event_limit_exceeded" },
      type: "psychiatrist.answer.failed",
    });
  });

  it("keeps the previous completed answer visible when regenerate is stopped", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-stop-"));
    const regenerateTurnId = EXTRA_TURN_IDS[0]!;
    const client = new CancelTrackingClient();
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What changed?" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      });
      return replay.some((event) => event.type === "psychiatrist.answer.completed");
    });
    activePsychiatristTurns.register({
      client,
      memoryId: MEMORY_ID,
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    activePsychiatristTurns.updateCodexIds({
      codexThreadId: "codex-thread-1",
      codexTurnId: "codex-turn-regenerate",
      turnId: regenerateTurnId,
    });
    const cancelHandler = createCancelPsychiatristTurnHandler({
      activeTurns: activePsychiatristTurns,
      config: { storePath },
    });

    const response = await cancelHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${regenerateTurnId}/cancel`, {
          body: cancelBody(),
          method: "POST",
        }),
        { turnId: regenerateTurnId },
      ),
    );

    expect(response.status).toBe(202);
    expect(client.cancelCalls).toEqual([
      { threadId: "codex-thread-1", turnId: "codex-turn-regenerate" },
    ]);
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({ content: "Original answer." }),
        pairId: PAIR_ID,
        status: "completed",
        turnId: TURN_ID,
      }),
    ]);
    await expect(
      readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "pairs",
          PAIR_ID,
          "RESPONSE.md",
        ),
        "utf8",
      ),
    ).resolves.toBe("Original answer.");
    await expect(
      readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "turns",
          `${regenerateTurnId}.json`,
        ),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      pair_id: PAIR_ID,
      regenerate_from_turn_id: TURN_ID,
      safe_error: {
        code: "turn_stopped",
      },
      status: "canceled",
      thread_id: THREAD_ID,
      turn_id: regenerateTurnId,
    });
  });

  it("rejects regenerate for a non-completed pair", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-pending-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const handler = createSendPsychiatristMessageHandler({
      client: new HangingConversationClient(),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Still running" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    const regenerate = createRegeneratePsychiatristResponseHandler({
      client: new FakeConversationClient("unused"),
      config: config(storePath),
    });

    const response = await regenerate(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "regenerate_unavailable",
    });
  });

  it("uses regenerate_unavailable when regenerate pair lookup fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-missing-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const regenerate = createRegeneratePsychiatristResponseHandler({
      client: new FakeConversationClient("unused"),
      config: config(storePath),
    });

    const response = await regenerate(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "regenerate_unavailable",
    });
  });

  it.each([
    {
      name: "missing sections",
      mutate: (snapshot: Record<string, unknown>) => {
        delete snapshot.sections;
      },
    },
    {
      name: "empty sections",
      mutate: (snapshot: Record<string, unknown>) => {
        snapshot.sections = [];
      },
    },
    {
      name: "blank source_url",
      mutate: (snapshot: Record<string, unknown>) => {
        snapshot.source_url = "  ";
      },
    },
    {
      name: "blank title",
      mutate: (snapshot: Record<string, unknown>) => {
        snapshot.title = "";
      },
    },
  ])("uses regenerate_unavailable when stored context has $name", async ({ mutate }) => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-context-invalid-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context(),
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "What changed?", web_source_permission: "deny" }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    const contextPath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "pairs",
      PAIR_ID,
      "CONTEXT.json",
    );
    const snapshot = parseJsonRecord(await readFile(contextPath, "utf8"));
    mutate(snapshot);
    await writeFile(contextPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    const regenerateClient = new FakeConversationClient("must not run");
    const regenerate = createRegeneratePsychiatristResponseHandler({
      client: regenerateClient,
      config: config(storePath),
    });

    const response = await regenerate(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "regenerate_unavailable",
    });
    expect(regenerateClient.inputs).toEqual([]);
  });

  it("rejects regenerate when the thread manifest is stale", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-stale-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Will be rejected." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    await markPsychiatristThreadStale({ config: { storePath }, threadId: THREAD_ID });
    const regenerateClient = new FakeConversationClient("must not run");
    const regenerate = createRegeneratePsychiatristResponseHandler({
      client: regenerateClient,
      config: config(storePath),
      generateId: createIdGenerator([EXTRA_TURN_IDS[0]!]),
    });

    const response = await regenerate(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      action: "refresh_thread",
      code: "thread_stale",
    });
    expect(regenerateClient.inputs).toEqual([]);
  });

  it("rejects an older prompt-policy regenerate before accepting any turn side effects", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-policy-stale-"));
    const originalContentHash = await seedSourceMemory(storePath, "# Original memory\n\nStored content.");
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({
        activeContentHash: originalContentHash,
        sourceHash: originalContentHash,
      }),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context({
        contentHash: originalContentHash,
        sourceHash: originalContentHash,
      }),
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Keep the stored answer." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    const regenerateTurnId = EXTRA_TURN_IDS[0]!;
    const threadDirectory = join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID);
    const manifestPath = join(threadDirectory, "THREAD.json");
    const storedManifest = parseJsonRecord(await readFile(manifestPath, "utf8"));
    storedManifest.policy_version = "psychiatrist-memory-pairs-old";
    await writeFile(manifestPath, `${JSON.stringify(storedManifest, null, 2)}\n`, "utf8");
    const threadMarkdownBefore = await readFile(join(threadDirectory, "THREAD.md"), "utf8");
    const calls: string[] = [];
    const regenerateClient = new FakeConversationClient("must not run");
    const regenerate = createRegeneratePsychiatristResponseHandler({
      appendRegeneratedAssistantResponse: async () => {
        calls.push("append regenerated response");
        return { status: "completed" };
      },
      appendRetriedAssistantResponse: async () => {
        calls.push("append retried response");
        return { status: "completed" };
      },
      backupQueue: {
        enqueue: async () => {
          calls.push("enqueue backup");
          return { backupStatus: "queued" };
        },
        persistIntent: async () => {
          calls.push("persist backup intent");
          return { backupStatus: "pending" };
        },
      },
      client: regenerateClient,
      config: config(storePath),
      generateId: () => {
        calls.push("generate id");
        return regenerateTurnId;
      },
    });

    const response = await regenerate(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      action: "refresh_thread",
      code: "thread_stale",
      message: "Psychiatrist thread is stale. Refresh the thread and retry.",
      status: "error",
    });
    expect(calls).toEqual([]);
    expect(regenerateClient.inputs).toEqual([]);
    expect(activePsychiatristTurns.hasActiveOrReservedThread(THREAD_ID)).toBe(false);
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.manifest).toMatchObject({
      policyVersion: "psychiatrist-memory-pairs-old",
      status: "stale",
    });
    expect(loaded.pairs[0]).toMatchObject({
      assistant: expect.objectContaining({ content: "Original answer." }),
      status: "completed",
      turnId: TURN_ID,
    });
    await expect(readFile(join(threadDirectory, "THREAD.md"), "utf8")).resolves.toBe(
      threadMarkdownBefore,
    );
    await expect(
      readFile(join(threadDirectory, "turns", `${regenerateTurnId}.json`), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(threadDirectory, "streams", `${regenerateTurnId}.jsonl`), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("regenerates from stored provenance after current memory content changes", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-stored-context-"));
    const originalContentHash = await seedSourceMemory(storePath, "# Original memory\n\nHistorical source body.");
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({
        activeContentHash: originalContentHash,
        sourceHash: originalContentHash,
      }),
    });
    const sendHandler = createSendPsychiatristMessageHandler({
      buildContext: async () => context({
        contentHash: originalContentHash,
        sections: [{
          anchor: "historical",
          endOffset: 37,
          level: 1,
          markdown: "Stored historical context only.",
          path: "historical",
          startOffset: 0,
          title: "Historical",
        }],
        sourceHash: originalContentHash,
      }),
      client: new FakeConversationClient("Original answer."),
      config: { storePath },
      generateId: createIdGenerator([PAIR_ID, TURN_ID]),
    });
    await sendHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}/messages`, {
          body: JSON.stringify({ message: "Use the historical snapshot." }),
          method: "POST",
        }),
        { threadId: THREAD_ID },
      ),
    );
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed" &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
    await writeMemoryContent({
      config: { storePath },
      frontmatter: memoryFrontmatter(),
      markdown: "# Current memory\n\nCurrent memory content must not replace stored context.",
      memoryId: MEMORY_ID,
    });
    const regenerateTurnId = EXTRA_TURN_IDS[0]!;
    const regenerateClient = new FakeConversationClient("Regenerated from stored context.");
    const regenerate = createRegeneratePsychiatristResponseHandler({
      client: regenerateClient,
      config: config(storePath),
      generateId: createIdGenerator([regenerateTurnId]),
    });

    const response = await regenerate(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: regenerateBody(),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(() => regenerateClient.inputs.length === 1);
    const regeneratePrompt = String(regenerateClient.inputs[0]?.input);
    expect(regeneratePrompt).toContain("Use the historical snapshot.");
    expect(regeneratePrompt).toContain("Stored historical context only.");
    expect(regeneratePrompt).not.toContain("Current memory content must not replace stored context.");
    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.manifest.status === "ready" &&
        loaded.pairs[0]?.assistant?.content === "Regenerated from stored context." &&
        activePsychiatristTurns.getByThreadId(THREAD_ID) === undefined;
    });
  });

  it("retries transient waitFor predicate errors until the condition passes", async () => {
    let attempts = 0;

    await waitFor(() => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("state not written yet");
      }
      return true;
    });

    expect(attempts).toBe(3);
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
    sourceHash: "sha256:context",
    sourceUrl: "https://example.com/memory",
    tags: [],
    title: "Memory",
    variantKind: "source",
    ...input,
  };
}

function createApiEvent(request: Request, params: Record<string, string>): APIEvent {
  if (request.body !== null && !request.headers.has("content-type")) {
    request.headers.set("content-type", "application/json");
  }
  return {
    request,
    params: { memoryId: MEMORY_ID, threadId: THREAD_ID, ...params },
    response: new Response(),
    locals: {},
    nativeEvent: {},
  } as unknown as APIEvent;
}

function psychiatristEventsUrl(turnId: string): string {
  return `/api/memories/${MEMORY_ID}/psychiatrist/threads/${THREAD_ID}` +
    `/turns/${turnId}/events?variant_kind=source`;
}

function parseJsonRecord(content: string): Record<string, unknown> {
  const value: unknown = JSON.parse(content);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected JSON record.");
  }
  return value as Record<string, unknown>;
}

function regenerateBody(input: {
  langCode?: string | null;
  memoryId?: string;
  threadId?: string;
  variantKind?: "source" | "translation";
  webSourcePermission?: "deny" | "allow_for_this_turn";
} = {}): string {
  return JSON.stringify({
    lang_code: input.langCode ?? null,
    memory_id: input.memoryId ?? MEMORY_ID,
    thread_id: input.threadId ?? THREAD_ID,
    variant_kind: input.variantKind ?? "source",
    web_source_permission: input.webSourcePermission ?? "deny",
  });
}

function cancelBody(input: {
  langCode?: string | null;
  memoryId?: string;
  pairId?: string;
  threadId?: string;
  variantKind?: "source" | "translation";
} = {}): string {
  return JSON.stringify({
    lang_code: input.langCode ?? null,
    memory_id: input.memoryId ?? MEMORY_ID,
    pair_id: input.pairId ?? PAIR_ID,
    thread_id: input.threadId ?? THREAD_ID,
    variant_kind: input.variantKind ?? "source",
  });
}

function manifest(input: Partial<PsychiatristThreadManifest> = {}): PsychiatristThreadManifest {
  return {
    activeContentHash: "sha256:context",
    createdAt: "2026-06-01T00:00:00.000Z",
    memoryId: MEMORY_ID,
    policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
    sourceHash: "sha256:context",
    status: "ready",
    threadId: THREAD_ID,
    updatedAt: "2026-06-01T00:00:00.000Z",
    variantKind: "source",
    ...input,
  };
}

function config(storePath: string) {
  return {
    backup: {
      git: {
        branch: "main",
        commitMessageTemplate: "backup {action} {memory_id}",
        enabled: false,
        push: false,
        remote: "origin",
      },
    },
    configFilePath: join(storePath, "trauma.config.json"),
    databasePath: join(storePath, "trauma.db"),
    projectPath: storePath,
    storePath,
  };
}

function memoryFrontmatter() {
  return {
    capturedAt: "2026-06-01T00:00:00.000Z",
    extractionStatus: "success" as const,
    id: MEMORY_ID,
    title: "Memory",
    url: "https://example.com/memory",
  };
}

async function seedSourceMemory(storePath: string, markdown: string): Promise<string> {
  const resolvedConfig = config(storePath);
  const connection = initializeDatabase(resolvedConfig);
  try {
    await connection.repositories.memories.create({
      backupStatus: "disabled",
      contentPath: `memories/${MEMORY_ID}/CONTENT.md`,
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      description: null,
      extractionError: null,
      extractionStatus: "success",
      faviconUrl: null,
      id: MEMORY_ID,
      lastBackupAt: null,
      lastBackupError: null,
      title: "Memory",
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
      url: "https://example.com/memory",
    });
  } finally {
    connection.close();
  }
  await writeMemoryContent({
    config: { storePath },
    frontmatter: memoryFrontmatter(),
    markdown,
    memoryId: MEMORY_ID,
  });
  return createSha256ContentHash(
    await readFile(join(storePath, "memories", MEMORY_ID, "CONTENT.md")),
  );
}

function createIdGenerator(ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `019e8a00-0000-7000-8000-${String(index).padStart(12, "0")}`;
}

class FakeConversationClient implements CodexConversationClient {
  readonly inputs: CodexConversationTurnInput[] = [];

  constructor(
    private readonly outputText: string,
    private readonly sourceCitations: PsychiatristSourceCitation[] = [],
  ) {}

  async cancelTurn(): Promise<void> {
    return undefined;
  }

  async probe(): Promise<void> {
    return undefined;
  }

  async runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult> {
    this.inputs.push(input);
    input.onEvent?.({ message: "Reading the active memory context.", type: "process" });
    input.onEvent?.({ text: "partial answer", type: "delta" });
    return {
      outputText: this.outputText,
      sourceCitations: this.sourceCitations,
      threadId: input.threadId ?? "codex-thread-1",
      turnId: "codex-turn-1",
    };
  }
}

class BackpressureAwareFloodingClient implements CodexConversationClient {
  async cancelTurn(): Promise<void> {
    return undefined;
  }

  async probe(): Promise<void> {
    return undefined;
  }

  async runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult> {
    for (const text of ["first", "second"]) {
      if (input.onEvent?.({ text, type: "delta" }) === false) {
        throw new CodexAppServerError(
          "event_limit_exceeded",
          "event consumer applied backpressure",
        );
      }
    }
    return {
      outputText: "Must not complete.",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
    };
  }
}

function tinyTurnLimits(overrides: {
  maxFinalAnswerBytes?: number;
  maxTurnEvents?: number;
} = {}) {
  return {
    eventPersistence: {
      maxEventBytes: 1_024,
      maxPendingBytes: 4_096,
      maxPendingEvents: 16,
      maxTurnBytes: 4_096,
      maxTurnEvents: overrides.maxTurnEvents ?? 16,
    },
    maxFinalAnswerBytes: overrides.maxFinalAnswerBytes ?? 1_024,
  };
}

class HangingConversationClient implements CodexConversationClient {
  async cancelTurn(): Promise<void> {
    return undefined;
  }

  async probe(): Promise<void> {
    return undefined;
  }

  async runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult> {
    input.onEvent?.({ type: "turn.started", turnId: "codex-turn-1" });
    await new Promise(() => undefined);
    return {
      outputText: "",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
    };
  }
}

class FailingConversationClient implements CodexConversationClient {
  async cancelTurn(): Promise<void> {
    return undefined;
  }

  async probe(): Promise<void> {
    return undefined;
  }

  async runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult> {
    input.onEvent?.({ type: "thread.started", threadId: "codex-thread-1" });
    input.onEvent?.({ type: "turn.started", turnId: "codex-turn-1" });
    throw new Error("raw failure with /private/tmp/store and token");
  }
}

class LateEventFailingConversationClient implements CodexConversationClient {
  private onEvent: CodexConversationTurnInput["onEvent"];

  async cancelTurn(): Promise<void> {
    return undefined;
  }

  emitLateDelta(): void {
    this.onEvent?.({ text: "late answer", type: "delta" });
  }

  async probe(): Promise<void> {
    return undefined;
  }

  async runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult> {
    this.onEvent = input.onEvent;
    input.onEvent?.({ text: "partial answer", type: "delta" });
    throw new Error("runtime failed while event persistence was pending");
  }
}

class ControlledFailingConversationClient implements CodexConversationClient {
  private failTurn: (() => void) | undefined;

  async cancelTurn(): Promise<void> {
    return undefined;
  }

  fail(): void {
    this.failTurn?.();
  }

  async probe(): Promise<void> {
    return undefined;
  }

  async runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult> {
    input.onEvent?.({ type: "thread.started", threadId: "codex-thread-1" });
    input.onEvent?.({ type: "turn.started", turnId: "codex-turn-1" });
    await new Promise<void>((resolve) => {
      this.failTurn = resolve;
    });
    throw new Error("runtime failed after cancellation");
  }
}

class WebSourceRequiredClient implements CodexConversationClient {
  readonly inputs: CodexConversationTurnInput[] = [];

  async cancelTurn(): Promise<void> {
    return undefined;
  }

  async probe(): Promise<void> {
    return undefined;
  }

  async runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult> {
    this.inputs.push(input);
    return {
      outputText: "I need current release notes.",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      webSourceRequired: true,
    };
  }
}

class CancelTrackingClient implements CodexConversationClient {
  readonly cancelCalls: Array<{ threadId: string; turnId: string }> = [];

  async cancelTurn(input: { threadId: string; turnId: string }): Promise<void> {
    this.cancelCalls.push(input);
  }

  async probe(): Promise<void> {
    return undefined;
  }

  async runConversationTurn(input: CodexConversationTurnInput) {
    input.onEvent?.({ type: "thread.started", threadId: "codex-thread-1" });
    input.onEvent?.({ type: "turn.started", turnId: "codex-turn-1" });
    await new Promise(() => undefined);
    return {
      outputText: "",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
    };
  }
}

class FailingCancelTrackingClient implements CodexConversationClient {
  readonly cancelCalls: Array<{ threadId: string; turnId: string }> = [];

  async cancelTurn(input: { threadId: string; turnId: string }): Promise<void> {
    this.cancelCalls.push(input);
    throw new Error("Codex interrupt failed with /private/tmp/store");
  }

  async probe(): Promise<void> {
    return undefined;
  }

  async runConversationTurn(input: CodexConversationTurnInput) {
    input.onEvent?.({ type: "thread.started", threadId: "codex-thread-1" });
    input.onEvent?.({ type: "turn.started", turnId: "codex-turn-1" });
    await new Promise(() => undefined);
    return {
      outputText: "",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
    };
  }
}

class NoCodexIdsCancelTrackingClient implements CodexConversationClient {
  readonly cancelCalls: Array<{ threadId: string; turnId: string }> = [];

  async cancelTurn(input: { threadId: string; turnId: string }): Promise<void> {
    this.cancelCalls.push(input);
  }

  async probe(): Promise<void> {
    return undefined;
  }

  async runConversationTurn() {
    await new Promise(() => undefined);
    return {
      outputText: "",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
    };
  }
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await predicate()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (lastError instanceof Error) {
    throw new Error("condition was not met before timeout", { cause: lastError });
  }
  throw new Error("condition was not met before timeout");
}

function createDeferred<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });
  return { promise, reject, resolve };
}
