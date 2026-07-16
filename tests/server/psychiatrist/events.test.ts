import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { APIEvent } from "@solidjs/start/server";

import { activePsychiatristTurns } from "../../../src/server/psychiatrist/active-turns";
import { createPsychiatristTurnEventsHandler } from "../../../src/server/psychiatrist/events-route";
import {
  appendPsychiatristStreamEvent,
  loadPsychiatristStreamReplay,
} from "../../../src/server/psychiatrist/stream-store";
import {
  appendAssistantResponse,
  appendPendingPair,
  createPsychiatristThread,
  loadPsychiatristThread,
  markPsychiatristTurnCanceled,
  markPsychiatristTurnCompleted,
  recordPsychiatristTurnStarted,
} from "../../../src/server/psychiatrist/thread-store";
import { PSYCHIATRIST_PROMPT_POLICY_VERSION } from "../../../src/server/psychiatrist/prompt";
import type {
  PsychiatristContextSnapshotManifest,
  PsychiatristStreamEvent,
  PsychiatristThreadManifest,
} from "../../../src/server/psychiatrist/types";

const MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001";
const MEMORY_ID_2 = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f002";
const THREAD_ID = "019e8a00-0000-7000-8000-000000000001";
const TURN_ID = "019e8a00-0000-7000-8000-000000000003";

describe("Psychiatrist stream store", () => {
  afterEach(() => {
    activePsychiatristTurns.clear();
  });

  it("persists replayable stream events in turn-local order", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-stream-"));

    const started = await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    const delta = await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { text: "The memory says " },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.delta",
      },
    });
    const completed = await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { pair_id: "pair-1" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.completed",
      },
    });

    expect(started).toBeDefined();
    expect(delta).toBeDefined();
    expect(completed).toBeDefined();
    expect([started!.eventId, delta!.eventId, completed!.eventId]).toEqual([
      "000000000001",
      "000000000002",
      "000000000003",
    ]);
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.turn.started",
      "psychiatrist.answer.delta",
      "psychiatrist.answer.completed",
    ]);

    const afterFirst = await loadPsychiatristStreamReplay({
      afterEventId: "000000000001",
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(afterFirst.map((event) => event.eventId)).toEqual([
      "000000000002",
      "000000000003",
    ]);
  });

  it("serializes concurrent appends so event ids remain unique", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-stream-concurrent-"));

    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        appendPsychiatristStreamEvent({
          config: { storePath },
          event: {
            data: { text: `delta ${index}` },
            memoryId: MEMORY_ID,
            threadId: THREAD_ID,
            turnId: TURN_ID,
            type: "psychiatrist.answer.delta",
          },
        })
      ),
    );

    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.eventId)).toEqual([
      "000000000001",
      "000000000002",
      "000000000003",
      "000000000004",
      "000000000005",
      "000000000006",
    ]);
  });

  it("recovers a torn final stream fragment before appending the next monotonic event", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-stream-torn-tail-"));
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    const streamPath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "streams",
      `${TURN_ID}.jsonl`,
    );
    const completePrefix = await readFile(streamPath, "utf8");
    await appendFile(streamPath, '{"eventId":"000000000002"', "utf8");

    await expect(loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    })).resolves.toEqual([
      expect.objectContaining({ eventId: "000000000001" }),
    ]);

    const appended = await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { text: "Recovered stream." },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.delta",
      },
    });
    expect(appended?.eventId).toBe("000000000002");
    await expect(loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    })).resolves.toEqual([
      expect.objectContaining({ eventId: "000000000001" }),
      expect.objectContaining({ eventId: "000000000002" }),
    ]);
    const repairedJsonl = await readFile(streamPath, "utf8");
    expect(repairedJsonl.endsWith("\n")).toBe(true);
    expect(repairedJsonl.startsWith(completePrefix)).toBe(true);
    expect(repairedJsonl.trim().split("\n").map((line) => JSON.parse(line))).toHaveLength(2);
  });

  it("rejects corruption in a complete newline-terminated stream row", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-stream-corrupt-row-"));
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    const streamPath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "streams",
      `${TURN_ID}.jsonl`,
    );
    await appendFile(streamPath, "not-json\n", "utf8");

    await expect(loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    })).rejects.toThrow(SyntaxError);
    await expect(appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { text: "Must not append." },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.delta",
      },
    })).rejects.toThrow(SyntaxError);
  });

  it("filters unsafe process events before writing JSONL replay", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-stream-safe-"));

    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "hidden chain-of-thought from /private/store/path" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Loaded sk-live-123 from environment." },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { text: "Reading the active memory context." },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.process.delta",
      },
    });

    const streamPath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "streams",
      `${TURN_ID}.jsonl`,
    );
    const jsonl = await readFile(streamPath, "utf8");
    expect(jsonl).toContain("Reading the active memory context.");
    expect(jsonl).not.toContain("hidden chain-of-thought");
    expect(jsonl).not.toContain("/private/store/path");
    expect(jsonl).not.toContain("sk-live");
  });

  it("projects process events before persistence instead of storing raw payloads", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-stream-project-"));

    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: {
          raw: {
            referencePath: "/Users/example/.codex/auth.json",
            referenceLabel: "placeholder-token",
          },
          text: "Searching trusted sources.",
        },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.process.delta",
      },
    });

    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay).toHaveLength(1);
    expect(replay[0]?.data).toEqual({ text: "Searching trusted sources." });
    expect(JSON.stringify(replay)).not.toContain("referencePath");
    expect(JSON.stringify(replay)).not.toContain("sk-live");
  });

  it("projects all persisted stream event types instead of storing raw payloads", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-stream-project-types-"));

    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: {
          pair_id: "pair-1",
          raw: { snippet: "token-123", path: "C:\\Users\\me\\.codex\\auth.json" },
        },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.completed",
      },
    });
    const unknown = await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { raw: { snippet: "token-unknown" } },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.raw.event",
      } as never,
    });

    expect(unknown).toBeUndefined();
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay).toHaveLength(1);
    expect(replay[0]?.data).toEqual({ pair_id: "pair-1" });
    expect(JSON.stringify(replay)).not.toContain("sk-live");
    expect(JSON.stringify(replay)).not.toContain("C:\\Users");
  });

  it("filters Windows, UNC, and credential-bearing home-relative process paths", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-stream-process-bound-"));

    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Inspecting C:\\Users\\me\\.codex\\auth.json" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Inspecting \\\\server\\share\\secret.txt" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Checking ~/.codex/auth.json before requesting access." },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Checking ~/.ssh/id_rsa before requesting access." },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Checking ~/.ssh/id_ed25519.pub before requesting access." },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { text: `Reading ${"context ".repeat(80)}` },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.process.delta",
      },
    });

    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay).toHaveLength(1);
    const data = replay[0]?.data;
    const text = isTextData(data) ? data.text : undefined;
    expect(text).toEqual(expect.stringMatching(/\.\.\.$/));
    expect(JSON.stringify(replay)).not.toContain("C:\\Users");
    expect(JSON.stringify(replay)).not.toContain("\\\\server\\share");
    expect(JSON.stringify(replay)).not.toContain("~/.codex/auth.json");
    expect(JSON.stringify(replay)).not.toContain("~/.ssh/id_rsa");
    expect(JSON.stringify(replay)).not.toContain("~/.ssh/id_ed25519");
    expect(text?.length).toBeLessThanOrEqual(240);
  });

  it("filters key-value formatted absolute paths from process and status text", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-stream-kv-paths-"));

    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Working cwd=/tmp" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Working root=/workspace" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Working cwd:/workspace/app" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Working path=/Users/example/.codex/auth.json" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Working cwd=C:\\Users\\me\\.codex\\auth.json" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Working share=\\\\server\\share\\auth.json" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "running in cwd=/Users/example/.codex/auth.json" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "reading the active memory context" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.thread.stale",
      },
    });

    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay).toHaveLength(2);
    expect(replay.map((event) => event.data)).toEqual([
      { status: "running" },
      { code: "thread_stale", status: "reading the active memory context" },
    ]);
    expect(JSON.stringify(replay)).not.toContain("/tmp");
    expect(JSON.stringify(replay)).not.toContain("/workspace");
    expect(JSON.stringify(replay)).not.toContain("/workspace/app");
    expect(JSON.stringify(replay)).not.toContain("/Users/example");
    expect(JSON.stringify(replay)).not.toContain("C:\\Users");
    expect(JSON.stringify(replay)).not.toContain("\\\\server\\share");
  });

  it("filters local endpoints from process and status text", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-stream-local-endpoint-"));

    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Connected to http://127.0.0.1:63921/session" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Connected to unix:///tmp/app-server.sock" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Connected to ws://127.0.0.1:63921/events" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Connected to wss://localhost:63921/events" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "Connected to http://[::1]:63921/session" },
          memoryId: MEMORY_ID,
          threadId: THREAD_ID,
          turnId: TURN_ID,
          type: "psychiatrist.process.delta",
        },
      }),
    ).resolves.toBeUndefined();
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "using http://localhost:5540/events" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { text: "Reading the active memory context." },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.process.delta",
      },
    });

    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.data)).toEqual([
      { status: "running" },
      { text: "Reading the active memory context." },
    ]);
    expect(JSON.stringify(replay)).not.toContain("127.0.0.1");
    expect(JSON.stringify(replay)).not.toContain("unix://");
    expect(JSON.stringify(replay)).not.toContain("localhost");
    expect(JSON.stringify(replay)).not.toContain("[::1]");
    expect(JSON.stringify(replay)).not.toContain("ws://");
    expect(JSON.stringify(replay)).not.toContain("wss://");
  });

  it("replays persisted SSE events after the requested event id", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-"));
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { text: "Answer delta" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.delta",
      },
    });
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { pair_id: "pair-1" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.completed",
      },
    });
    const handler = createPsychiatristTurnEventsHandler({
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(
          `http://localhost/api/psychiatrist-turns/${TURN_ID}/events?after_event_id=000000000001`,
        ),
        { turnId: TURN_ID },
      ),
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).not.toContain("psychiatrist.turn.started");
    expect(text).toContain("event: psychiatrist.answer.delta");
    expect(text).toContain("event: psychiatrist.answer.completed");
  });

  it("rejects cross-memory and cross-variant replay before loading a stream", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-scope-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    const replayCalls: unknown[] = [];
    const handler = createPsychiatristTurnEventsHandler({
      config: { storePath },
      loadReplay: async (input) => {
        replayCalls.push(input);
        return [];
      },
    });

    const crossMemory = await handler(createApiEvent(
      new Request("http://localhost/events?variant_kind=source"),
      { memoryId: MEMORY_ID_2, threadId: THREAD_ID, turnId: TURN_ID },
    ));
    const crossVariant = await handler(createApiEvent(
      new Request("http://localhost/events?variant_kind=translation&lang_code=ja-JP"),
      { memoryId: MEMORY_ID, threadId: THREAD_ID, turnId: TURN_ID },
    ));

    expect(crossMemory.status).toBe(404);
    expect(crossVariant.status).toBe(404);
    expect(replayCalls).toEqual([]);
  });

  it("replays only the latest terminal event when a later warning completion exists", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-terminal-replay-"));
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    const firstTerminal = await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { pair_id: "pair-1", text: "Saved before backup." },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.completed",
      },
    });
    const warningTerminal = await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: {
          pair_id: "pair-1",
          text: "Saved with warning.",
          warning: {
            code: "backup_enqueue_failed",
            message: "Psychiatrist answer was saved, but backup enqueue failed.",
          },
        },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.completed",
      },
    });
    expect(firstTerminal).toBeDefined();
    expect(warningTerminal).toBeDefined();
    if (firstTerminal === undefined) {
      throw new Error("Expected first terminal stream event to persist.");
    }
    if (warningTerminal === undefined) {
      throw new Error("Expected warning terminal stream event to persist.");
    }
    const handler = createPsychiatristTurnEventsHandler({
      config: { storePath },
    });

    const fullReplay = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`),
        { turnId: TURN_ID },
      ),
    );
    const afterFirstTerminalReplay = await handler(
      createApiEvent(
        new Request(
          `http://localhost/api/psychiatrist-turns/${TURN_ID}/events?after_event_id=${firstTerminal.eventId}`,
        ),
        { turnId: TURN_ID },
      ),
    );
    const afterWarningTerminalReplay = await handler(
      createApiEvent(
        new Request(
          `http://localhost/api/psychiatrist-turns/${TURN_ID}/events?after_event_id=${warningTerminal.eventId}`,
        ),
        { turnId: TURN_ID },
      ),
    );
    const fullText = await fullReplay.text();
    const afterFirstText = await afterFirstTerminalReplay.text();
    const afterWarningText = await afterWarningTerminalReplay.text();

    expect(fullReplay.status).toBe(200);
    expect(afterFirstTerminalReplay.status).toBe(200);
    expect(afterWarningTerminalReplay.status).toBe(200);
    expect(fullText).not.toContain("Saved before backup.");
    expect(fullText).toContain("Saved with warning.");
    expect(fullText).toContain("backup_enqueue_failed");
    expect(afterFirstText).not.toContain("Saved before backup.");
    expect(afterFirstText).toContain("Saved with warning.");
    expect(afterFirstText).toContain("backup_enqueue_failed");
    expect(afterWarningText).not.toContain("Saved before backup.");
    expect(afterWarningText).not.toContain("Saved with warning.");
    expect(afterWarningText).not.toContain("backup_enqueue_failed");
  });

  it("reconciles inactive non-terminal replay before returning non-live SSE", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-reconcile-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: "019e8a00-0000-7000-8000-000000000002",
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    const partial = await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { text: "Partial answer" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.delta",
      },
    });
    expect(partial).toBeDefined();
    if (partial === undefined) {
      throw new Error("Expected partial stream event to persist.");
    }
    activePsychiatristTurns.unregister(TURN_ID);
    const handler = createPsychiatristTurnEventsHandler({
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`, {
          headers: {
            "Last-Event-ID": partial.eventId,
          },
        }),
        { turnId: TURN_ID },
      ),
    );
    const text = await response.text();
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });

    expect(response.status).toBe(200);
    expect(text).not.toContain("event: psychiatrist.turn.started");
    expect(text).not.toContain("event: psychiatrist.answer.delta");
    expect(text).toContain("event: psychiatrist.answer.failed");
    expect(text).toContain("\"code\":\"turn_interrupted\"");
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        pairId: "019e8a00-0000-7000-8000-000000000002",
        status: "failed",
        turnId: TURN_ID,
      }),
    ]);
  });

  it("reconciles an inactive first answer when its directly owned replay is empty", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-empty-answer-"));
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: "019e8a00-0000-7000-8000-000000000002",
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await recordPsychiatristTurnStarted({
      config: { storePath },
      pairId: "019e8a00-0000-7000-8000-000000000002",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    const response = await createPsychiatristTurnEventsHandler({ config: { storePath } })(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`),
        { turnId: TURN_ID },
      ),
    );
    const text = await response.text();

    expect(text).toContain("event: psychiatrist.answer.failed");
    expect(text).toContain('"code":"turn_interrupted"');
    await expect(loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID }))
      .resolves.toMatchObject({
        pairs: [expect.objectContaining({ status: "failed", turnId: TURN_ID })],
      });
  });

  it("repairs a completed first answer when its directly owned replay is empty", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-empty-completed-"));
    const pairId = "019e8a00-0000-7000-8000-000000000002";
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "Recovered answer.",
      citations: [],
      config: { storePath },
      pairId,
      threadId: THREAD_ID,
    });

    const response = await createPsychiatristTurnEventsHandler({ config: { storePath } })(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`),
        { turnId: TURN_ID },
      ),
    );
    const text = await response.text();

    expect(text).toContain("event: psychiatrist.answer.completed");
    expect(text).toContain("Recovered answer.");
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.filter((event) => event.type === "psychiatrist.answer.completed"))
      .toHaveLength(1);
  });

  it("reconciles an inactive Regenerate when its replay is empty and preserves the prior response", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-empty-regenerate-"));
    const pairId = "019e8a00-0000-7000-8000-000000000002";
    const regenerateTurnId = "019e8a00-0000-7000-8000-000000000005";
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "Keep this prior answer.",
      citations: [],
      config: { storePath },
      pairId,
      threadId: THREAD_ID,
    });
    await markPsychiatristTurnCompleted({
      config: { storePath },
      pairId,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await recordPsychiatristTurnStarted({
      config: { storePath },
      pairId,
      regenerateFromTurnId: TURN_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });

    const response = await createPsychiatristTurnEventsHandler({ config: { storePath } })(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${regenerateTurnId}/events`),
        { turnId: regenerateTurnId },
      ),
    );
    const text = await response.text();
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });

    expect(text).toContain("event: psychiatrist.answer.failed");
    expect(text).toContain('"code":"turn_interrupted"');
    expect(loaded.pairs[0]).toMatchObject({
      assistant: expect.objectContaining({ content: "Keep this prior answer." }),
      status: "completed",
      turnId: TURN_ID,
    });
  });

  it("repairs one canceled terminal over a non-empty replay and preserves Last-Event-ID", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-canceled-repair-"));
    const pairId = "019e8a00-0000-7000-8000-000000000002";
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId,
      prompt: "Stop this answer.",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const started = await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { pair_id: pairId, status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { text: "Partial answer" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.delta",
      },
    });
    await markPsychiatristTurnCanceled({
      config: { storePath },
      pairId,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(started).toBeDefined();

    const handler = createPsychiatristTurnEventsHandler({ config: { storePath } });
    const first = await handler(createApiEvent(
      new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`, {
        headers: { "Last-Event-ID": started!.eventId },
      }),
      { turnId: TURN_ID },
    ));
    const second = await handler(createApiEvent(
      new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`),
      { turnId: TURN_ID },
    ));
    const firstText = await first.text();
    const secondText = await second.text();
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    expect(firstText).not.toContain("event: psychiatrist.turn.started");
    expect(firstText).toContain("event: psychiatrist.answer.delta");
    expect(firstText).toContain("event: psychiatrist.turn.canceled");
    expect(secondText.match(/event: psychiatrist\.turn\.canceled/g)).toHaveLength(1);
    expect(replay.filter((event) => event.type === "psychiatrist.turn.canceled"))
      .toHaveLength(1);
  });

  it("keeps the current same-thread turn active when replaying an old inactive stream", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-active-thread-"));
    const currentPairId = "019e8a00-0000-7000-8000-000000000005";
    const currentTurnId = "019e8a00-0000-7000-8000-000000000006";
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: "019e8a00-0000-7000-8000-000000000002",
      prompt: "Old question?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: {
        ...contextSnapshot(),
        contextSnapshotId: "snapshot-2",
        userPrompt: "Current question?",
      },
      pairId: currentPairId,
      prompt: "Current question?",
      threadId: THREAD_ID,
      turnId: currentTurnId,
    });
    await recordPsychiatristTurnStarted({
      config: { storePath },
      pairId: currentPairId,
      threadId: THREAD_ID,
      turnId: currentTurnId,
    });
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { text: "Old partial answer" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.delta",
      },
    });
    activePsychiatristTurns.register({
      client: {
        cancelTurn: async () => undefined,
        probe: async () => undefined,
        runConversationTurn: async () => ({
          outputText: "",
          threadId: THREAD_ID,
          turnId: currentTurnId,
        }),
      },
      memoryId: MEMORY_ID,
      pairId: currentPairId,
      threadId: THREAD_ID,
      turnId: currentTurnId,
    });
    const handler = createPsychiatristTurnEventsHandler({
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`),
        { turnId: TURN_ID },
      ),
    );
    const text = await response.text();
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });

    expect(response.status).toBe(200);
    expect(text).toContain("event: psychiatrist.answer.failed");
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        pairId: "019e8a00-0000-7000-8000-000000000002",
        status: "failed",
        turnId: TURN_ID,
      }),
      expect.objectContaining({
        pairId: currentPairId,
        status: "pending",
        turnId: currentTurnId,
      }),
    ]);
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${currentTurnId}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      status: "started",
      turn_id: currentTurnId,
    });
  });

  it("streams live events after replay while the turn remains active", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-live-"));
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    activePsychiatristTurns.register({
      client: {
        cancelTurn: async () => undefined,
        probe: async () => undefined,
        runConversationTurn: async () => ({
          outputText: "",
          threadId: THREAD_ID,
          turnId: TURN_ID,
        }),
      },
      memoryId: MEMORY_ID,
      pairId: "019e8a00-0000-7000-8000-000000000002",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const handler = createPsychiatristTurnEventsHandler({
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`),
        { turnId: TURN_ID },
      ),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await expect(readChunk(reader!)).resolves.toContain("event: psychiatrist.turn.started");

    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { text: "Live answer delta" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.answer.delta",
      },
    });

    await expect(readChunk(reader!)).resolves.toContain("Live answer delta");
    await reader?.cancel();
  });

  it("buffers live events until stored replay has been sent", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-buffered-"));
    activePsychiatristTurns.register({
      client: {
        cancelTurn: async () => undefined,
        probe: async () => undefined,
        runConversationTurn: async () => ({
          outputText: "",
          threadId: THREAD_ID,
          turnId: TURN_ID,
        }),
      },
      memoryId: MEMORY_ID,
      pairId: "019e8a00-0000-7000-8000-000000000002",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    let onLiveEvent: ((event: PsychiatristStreamEvent) => void) | undefined;
    let resolveReplay: ((events: PsychiatristStreamEvent[]) => void) | undefined;
    const replayPromise = new Promise<PsychiatristStreamEvent[]>((resolve) => {
      resolveReplay = resolve;
    });
    const handler = createPsychiatristTurnEventsHandler({
      config: { storePath },
      loadReplay: async () => await replayPromise,
      subscribe: (input) => {
        onLiveEvent = input.onEvent;
        return () => undefined;
      },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`),
        { turnId: TURN_ID },
      ),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    onLiveEvent?.(streamEvent("000000000003", "psychiatrist.answer.completed", {
      pair_id: "pair-1",
    }));
    resolveReplay?.([
      streamEvent("000000000001", "psychiatrist.turn.started", { status: "running" }),
      streamEvent("000000000002", "psychiatrist.answer.delta", { text: "Stored delta" }),
    ]);

    await expect(readChunk(reader!)).resolves.toContain("psychiatrist.turn.started");
    await expect(readChunk(reader!)).resolves.toContain("Stored delta");
    await expect(readChunk(reader!)).resolves.toContain("psychiatrist.answer.completed");
    await expect(reader!.read()).resolves.toMatchObject({ done: true });
  });

  it("unsubscribes live streams when replay loading fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-replay-fail-"));
    activePsychiatristTurns.register({
      client: {
        cancelTurn: async () => undefined,
        probe: async () => undefined,
        runConversationTurn: async () => ({
          outputText: "",
          threadId: THREAD_ID,
          turnId: TURN_ID,
        }),
      },
      memoryId: MEMORY_ID,
      pairId: "019e8a00-0000-7000-8000-000000000002",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    let unsubscribeCount = 0;
    const handler = createPsychiatristTurnEventsHandler({
      config: { storePath },
      loadReplay: async () => {
        throw new Error("replay failed");
      },
      subscribe: () => {
        return () => {
          unsubscribeCount += 1;
        };
      },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`),
        { turnId: TURN_ID },
      ),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    await expect(reader!.read()).rejects.toThrow("replay failed");
    expect(unsubscribeCount).toBe(1);
  });

  it("closes live streams after a replayed web-source permission event", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-sse-permission-"));
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { code: "network_permission_required", pair_id: "pair-1" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.network.permission_required",
      },
    });
    activePsychiatristTurns.register({
      client: {
        cancelTurn: async () => undefined,
        probe: async () => undefined,
        runConversationTurn: async () => ({
          outputText: "",
          threadId: THREAD_ID,
          turnId: TURN_ID,
        }),
      },
      memoryId: MEMORY_ID,
      pairId: "019e8a00-0000-7000-8000-000000000002",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const handler = createPsychiatristTurnEventsHandler({
      config: { storePath },
    });

    const response = await handler(
      createApiEvent(
        new Request(`http://localhost/api/psychiatrist-turns/${TURN_ID}/events`),
        { turnId: TURN_ID },
      ),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    await expect(readChunk(reader!)).resolves.toContain("psychiatrist.turn.started");
    await expect(readChunk(reader!)).resolves.toContain("psychiatrist.network.permission_required");
    await expect(reader!.read()).resolves.toMatchObject({ done: true });
  });
});

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const result = await reader.read();
  return new TextDecoder().decode(result.value);
}

function createApiEvent(request: Request, params: Record<string, string>): APIEvent {
  return {
    request,
    params: { memoryId: MEMORY_ID, threadId: THREAD_ID, ...params },
    response: new Response(),
    locals: {},
    nativeEvent: {},
  } as unknown as APIEvent;
}

function streamEvent(
  eventId: string,
  type: PsychiatristStreamEvent["type"],
  data: PsychiatristStreamEvent["data"],
): PsychiatristStreamEvent {
  return {
    data,
    eventId,
    memoryId: MEMORY_ID,
    threadId: THREAD_ID,
    timestamp: 1,
    turnId: TURN_ID,
    type,
  };
}

function isTextData(data: unknown): data is { text: string } {
  return typeof data === "object" &&
    data !== null &&
    "text" in data &&
    typeof data.text === "string";
}

function manifest(
  input: Partial<PsychiatristThreadManifest> = {},
): PsychiatristThreadManifest {
  return {
    activeContentHash: "sha256:source",
    createdAt: "2026-06-01T00:00:00.000Z",
    memoryId: MEMORY_ID,
    policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
    sourceHash: "sha256:source",
    status: "ready",
    threadId: THREAD_ID,
    updatedAt: "2026-06-01T00:00:00.000Z",
    variantKind: "source",
    ...input,
  };
}

function contextSnapshot(): PsychiatristContextSnapshotManifest {
  return {
    categories: [],
    contentHash: "sha256:source",
    contextSnapshotId: "snapshot-1",
    memoryId: MEMORY_ID,
    policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
    relativePath: `memories/${MEMORY_ID}/CONTENT.md`,
    selectedSectionAnchors: ["risk"],
    selectedSectionHashes: ["sha256:section"],
    sections: [
      {
        anchor: "risk",
        endOffset: 18,
        level: 2,
        markdown: "## Risk\n\nNo rollback.",
        path: "1",
        startOffset: 0,
        title: "Risk",
      },
    ],
    sourceUrl: "https://example.com/memory",
    tags: [],
    title: "Memory",
    userPrompt: "What is the risk?",
    variantKind: "source",
  };
}
