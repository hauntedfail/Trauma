import { describe, expect, it } from "vitest";

import {
  createPsychiatristEventPersistenceQueue,
  PsychiatristEventLimitError,
} from "../../../src/server/psychiatrist/event-persistence";

describe("Psychiatrist event persistence queue", () => {
  it("rejects producer backpressure before pending closures can grow without bound", async () => {
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writes: string[] = [];
    const queue = createPsychiatristEventPersistenceQueue({
      maxEventBytes: 8,
      maxPendingBytes: 8,
      maxPendingEvents: 2,
      maxTurnBytes: 16,
      maxTurnEvents: 4,
    });

    expect(queue.enqueue(async () => {
      writes.push("first");
      await firstWrite;
    }, 4)).toBe(true);
    expect(queue.enqueue(async () => {
      writes.push("second");
    }, 4)).toBe(true);
    expect(queue.enqueue(async () => {
      writes.push("unbounded");
    }, 1)).toBe(false);

    const drained = queue.drain();
    releaseFirst();
    await expect(drained).rejects.toBeInstanceOf(PsychiatristEventLimitError);
    expect(writes).toEqual(["first", "second"]);
    expect(queue.enqueue(async () => undefined, 1)).toBe(false);
  });

  it("enforces per-event and cumulative UTF-8 byte limits", async () => {
    const perEvent = createPsychiatristEventPersistenceQueue({
      maxEventBytes: 3,
      maxPendingBytes: 10,
      maxPendingEvents: 4,
      maxTurnBytes: 10,
      maxTurnEvents: 4,
    });
    expect(perEvent.enqueue(async () => undefined, 4)).toBe(false);
    await expect(perEvent.drain()).rejects.toMatchObject({
      code: "event_limit_exceeded",
      kind: "event_bytes",
    });

    const cumulative = createPsychiatristEventPersistenceQueue({
      maxEventBytes: 8,
      maxPendingBytes: 16,
      maxPendingEvents: 4,
      maxTurnBytes: 6,
      maxTurnEvents: 4,
    });
    expect(cumulative.enqueue(async () => undefined, 3)).toBe(true);
    expect(cumulative.enqueue(async () => undefined, 4)).toBe(false);
    await expect(cumulative.drain()).rejects.toMatchObject({
      code: "event_limit_exceeded",
      kind: "turn_bytes",
    });
  });
});
