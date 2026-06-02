import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { APIEvent } from "@solidjs/start/server";
import { describe, expect, it } from "vitest";

import { createSendPsychiatristMessageHandler } from "../../../src/server/psychiatrist/message-route";
import { createCancelPsychiatristTurnHandler } from "../../../src/server/psychiatrist/cancel-route";
import { createRegeneratePsychiatristResponseHandler } from "../../../src/server/psychiatrist/regenerate-route";
import { activePsychiatristTurns } from "../../../src/server/psychiatrist/active-turns";
import { loadPsychiatristStreamReplay } from "../../../src/server/psychiatrist/stream-store";
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
  PsychiatristThreadManifest,
} from "../../../src/server/psychiatrist/types";
import type {
  CodexAppServerEvent,
  CodexConversationClient,
  CodexConversationTurnInput,
} from "../../../src/server/translation/codex-app-server";

const MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001";
const THREAD_ID = "019e8a00-0000-7000-8000-000000000001";
const PAIR_ID = "019e8a00-0000-7000-8000-000000000002";
const TURN_ID = "019e8a00-0000-7000-8000-000000000003";

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

  it("sends a message, persists the pair, and records replayable stream events", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new FakeConversationClient("The memory says rollback is missing.");
    const handler = createSendPsychiatristMessageHandler({
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
        input: expect.stringContaining("What is the risk?"),
        networkAccess: "disabled",
      }),
    ]);

    await waitFor(async () => {
      const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
      return loaded.pairs[0]?.status === "completed";
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
    expect(JSON.stringify(replay)).not.toContain("/private/");
  });

  it("maps user-approved web source permission to a network-enabled turn", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-message-web-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const client = new FakeConversationClient("Cited answer.");
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
      return loaded.pairs[0]?.status === "completed";
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
    activePsychiatristTurns.register({
      client,
      codexThreadId: "codex-thread-1",
      codexTurnId: "codex-turn-1",
      memoryId: MEMORY_ID,
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
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.type)).toEqual([
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
      return loaded.pairs[0]?.status === "completed";
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
      return content === "Regenerated answer.";
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
    policyVersion: "psychiatrist-memory-v1",
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

  constructor(private readonly outputText: string) {}

  async cancelTurn(): Promise<void> {
    return undefined;
  }

  async probe(): Promise<void> {
    return undefined;
  }

  async runConversationTurn(input: CodexConversationTurnInput) {
    this.inputs.push(input);
    input.onEvent?.({ message: "Reading the active memory context.", type: "process" });
    input.onEvent?.({ text: "partial answer", type: "delta" });
    return {
      outputText: this.outputText,
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

  async runConversationTurn(input: CodexConversationTurnInput) {
    input.onEvent?.({ type: "turn.started", turnId: "codex-turn-1" });
    await new Promise(() => undefined);
    return {
      outputText: "",
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
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

  async runConversationTurn() {
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
