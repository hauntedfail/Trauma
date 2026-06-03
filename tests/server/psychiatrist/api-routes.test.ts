import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it } from "vitest";

import { createSendPsychiatristMessageHandler } from "../../../src/server/psychiatrist/message-route";
import { createCancelPsychiatristTurnHandler } from "../../../src/server/psychiatrist/cancel-route";
import { createRegeneratePsychiatristResponseHandler } from "../../../src/server/psychiatrist/regenerate-route";
import { activePsychiatristTurns } from "../../../src/server/psychiatrist/active-turns";
import { loadPsychiatristStreamReplay } from "../../../src/server/psychiatrist/stream-store";
import { PSYCHIATRIST_PROMPT_POLICY_VERSION } from "../../../src/server/psychiatrist/prompt";
import {
  createPsychiatristThread,
  loadPsychiatristThread,
} from "../../../src/server/psychiatrist/thread-store";
import {
  createReadPsychiatristThreadHandler,
  createStartPsychiatristThreadHandler,
} from "../../../src/server/psychiatrist/thread-route";
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
        event_url: `/api/psychiatrist-turns/${TURN_ID}/events`,
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
        new Request(`http://localhost/api/psychiatrist-threads/${THREAD_ID}`),
        { threadId: THREAD_ID },
      ),
    );

    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      active_turn: {
        event_url: `/api/psychiatrist-turns/${TURN_ID}/events`,
        pair_id: PAIR_ID,
        status: "running",
        turn_id: TURN_ID,
      },
      thread_id: THREAD_ID,
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

  it("reads a stored thread as safe JSON", async () => {
    const handler = createReadPsychiatristThreadHandler({
      config: { storePath: "/private/tmp/secret-store" },
      loadThread: async () => ({
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

  it("sends a message, persists the pair, and records replayable stream events", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new FakeConversationClient("The memory says rollback is missing.");
    const backupEnqueues: unknown[] = [];
    const handler = createSendPsychiatristMessageHandler({
      backupQueue: {
        enqueue: async (input) => {
          backupEnqueues.push(input);
          return { backupStatus: "queued" };
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
            client_message_id: "local-1",
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
      event_url: `/api/psychiatrist-turns/${TURN_ID}/events`,
      pair_id: PAIR_ID,
      replay_url: `/api/psychiatrist-turns/${TURN_ID}/events`,
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
    expect(backupEnqueues).toEqual([
      {
        contentPaths: [
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/THREAD.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/pairs/${PAIR_ID}/PROMPT.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/pairs/${PAIR_ID}/CONTEXT.json`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/pairs/${PAIR_ID}/RESPONSE.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/PAIRS.jsonl`,
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
        url: "https://example.com/releases?token=secret",
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
        threadId: THREAD_ID,
        turnId: TURN_ID,
      });
      return replay.some((event) => event.type === "psychiatrist.network.permission_required");
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        pairId: PAIR_ID,
        status: "failed",
        turnId: TURN_ID,
      }),
    ]);
    expect(loaded.pairs[0]?.assistant).toBeUndefined();
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay).toContainEqual(
      expect.objectContaining({
        data: {
          code: "network_permission_required",
          message: "Allow web-source access to answer this request.",
        },
        type: "psychiatrist.network.permission_required",
      }),
    );
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
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
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
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.thread.stale",
    ]);
    expect(JSON.stringify(replay)).not.toContain("What is current?");
  });

  it("marks stale threads when the loaded context hash changed", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-context-stale-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new FakeConversationClient("must not run");
    const handler = createSendPsychiatristMessageHandler({
      buildContext: async () => context({ contentHash: "sha256:changed" }),
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
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.turn.started",
      "psychiatrist.turn.canceled",
    ]);
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
    const regenerateTurnId = "019e8a00-0000-7000-8000-000000000004";
    const regenerateClient = new FakeConversationClient("Regenerated answer.");
    const regenerateHandler = createRegeneratePsychiatristResponseHandler({
      backupQueue: {
        enqueue: async (input) => {
          backupEnqueues.push(input);
          return { backupStatus: "queued" };
        },
      },
      client: regenerateClient,
      config: config(storePath),
      generateId: createIdGenerator([regenerateTurnId]),
    });

    const response = await regenerateHandler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-pairs/${PAIR_ID}/regenerate`, {
          body: JSON.stringify({ web_source_permission: "deny" }),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      event_url: `/api/psychiatrist-turns/${regenerateTurnId}/events`,
      pair_id: PAIR_ID,
      replay_url: `/api/psychiatrist-turns/${regenerateTurnId}/events`,
      status: "started",
      thread_id: THREAD_ID,
      turn_id: regenerateTurnId,
    });
    expect(regenerateClient.inputs[0]).toMatchObject({
      cwdPurpose: "psychiatrist",
      input: expect.stringContaining('"reason":"user_requested_regenerate"'),
      networkAccess: "disabled",
    });
    expect(regenerateClient.inputs[0]?.input).toContain("What changed?");
    expect(regenerateClient.inputs[0]?.input).toContain("Raw markdown");
    expect(regenerateClient.inputs[0]?.input).toContain("Memory");
    expect(regenerateClient.inputs[0]?.input).toContain("https://example.com/memory");

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
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/THREAD.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/pairs/${PAIR_ID}/RESPONSE.md`,
          `memories/${MEMORY_ID}/threads/${THREAD_ID}/PAIRS.jsonl`,
        ],
        memoryId: MEMORY_ID,
        reason: "psychiatrist_response_regenerate",
      },
    ]);
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.regenerate.started",
      "psychiatrist.process.delta",
      "psychiatrist.answer.delta",
      "psychiatrist.regenerate.completed",
    ]);
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
          body: JSON.stringify({ web_source_permission: "deny" }),
          method: "POST",
        }),
        { pairId: PAIR_ID },
      ),
    );

    expect(response.status).toBe(202);
    await waitFor(async () => {
      const replay = await loadPsychiatristStreamReplay({
        config: { storePath },
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
          body: JSON.stringify({ web_source_permission: "deny" }),
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

function manifest(): PsychiatristThreadManifest {
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

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}
