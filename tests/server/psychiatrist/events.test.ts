import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { APIEvent } from "@solidjs/start/server";

import { createPsychiatristTurnEventsHandler } from "../../../src/server/psychiatrist/events-route";
import {
  appendPsychiatristStreamEvent,
  loadPsychiatristStreamReplay,
} from "../../../src/server/psychiatrist/stream-store";

const MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001";
const THREAD_ID = "019e8a00-0000-7000-8000-000000000001";
const TURN_ID = "019e8a00-0000-7000-8000-000000000003";

describe("Psychiatrist stream store", () => {
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
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(afterFirst.map((event) => event.eventId)).toEqual([
      "000000000002",
      "000000000003",
    ]);
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
});

function createApiEvent(request: Request, params: Record<string, string>): APIEvent {
  return {
    request,
    params,
    response: new Response(),
    locals: {},
    nativeEvent: {},
  } as unknown as APIEvent;
}
