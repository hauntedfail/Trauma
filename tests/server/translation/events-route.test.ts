import type { APIEvent } from "@solidjs/start/server";
import { describe, expect, it, vi } from "vitest";

import { TranslationEventBus } from "../../../src/server/translation/events";
import {
  TRANSLATION_SSE_LIMITS,
  createTranslationJobEventsHandler,
} from "../../../src/server/translation/events-route";
import type { TranslationJobSnapshot } from "../../../src/server/translation/runner";

describe("translation job events route", () => {
  it("keeps each subscriber queue fixed at 128 events and 3 MiB", () => {
    expect(TRANSLATION_SSE_LIMITS).toEqual({
      maxPendingBytes: 3 * 1_024 * 1_024,
      maxPendingEvents: 128,
    });
  });

  it("closes the SSE stream after a terminal translation event", async () => {
    const eventBus = new TranslationEventBus();
    const handler = createTranslationJobEventsHandler({
      eventBus,
      readTranslationJobSnapshot: async () => createSnapshot("running"),
    });

    const response = await handler(createEventsApiEvent("job-terminal"));
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const first = await reader!.read();
    expect(decode(first.value)).toContain("translation.job.snapshot");

    eventBus.emit({
      data: {
        output_hash: "sha256:output",
        output_path: "memories/memory-terminal/ja-JP/CONTENT.md",
        reader_url: "/memories/ja-JP/memory-terminal",
      },
      jobId: "job-terminal",
      langCode: "ja-JP",
      memoryId: "memory-terminal",
      type: "translation.job.completed",
    });

    const terminal = await reader!.read();
    expect(decode(terminal.value)).toContain("translation.job.completed");
    await expect(reader!.read()).resolves.toMatchObject({ done: true });
  });

  it("rechecks terminal job state after subscribing to avoid late SSE races", async () => {
    let snapshotReads = 0;
    const handler = createTranslationJobEventsHandler({
      heartbeatIntervalMs: 1,
      readTranslationJobSnapshot: async () => {
        snapshotReads += 1;
        return createSnapshot(snapshotReads === 1 ? "running" : "complete");
      },
    });

    const response = await handler(createEventsApiEvent("job-terminal"));
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const first = await reader!.read();
    expect(decode(first.value)).toContain("\"status\":\"running\"");

    const terminal = await reader!.read();
    expect(decode(terminal.value)).toContain("\"status\":\"complete\"");
    await expect(reader!.read()).resolves.toMatchObject({ done: true });
    expect(snapshotReads).toBe(2);
  });

  it("closes the SSE stream when the job disappears after subscribing", async () => {
    let snapshotReads = 0;
    const handler = createTranslationJobEventsHandler({
      heartbeatIntervalMs: 1,
      readTranslationJobSnapshot: async () => {
        snapshotReads += 1;
        return snapshotReads === 1 ? createSnapshot("running") : null;
      },
    });

    const response = await handler(createEventsApiEvent("job-deleted"));
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const first = await reader!.read();
    expect(decode(first.value)).toContain("\"status\":\"running\"");

    await expect(reader!.read()).resolves.toMatchObject({ done: true });
    expect(snapshotReads).toBe(2);
  });

  it("unsubscribes exactly once when the request aborts during the refresh", async () => {
    const eventBus = new TrackingTranslationEventBus();
    const refresh = createDeferred<TranslationJobSnapshot | null>();
    const requestController = new AbortController();
    let snapshotReads = 0;
    const handler = createTranslationJobEventsHandler({
      eventBus,
      readTranslationJobSnapshot: async () => {
        snapshotReads += 1;
        return snapshotReads === 1
          ? createSnapshot("running")
          : refresh.promise;
      },
    });

    const response = await handler(
      createEventsApiEvent("job-aborted-refresh", requestController.signal),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await expect(reader!.read()).resolves.toMatchObject({ done: false });
    expect(eventBus.subscribeCalls).toBe(1);

    requestController.abort();

    expect(eventBus.unsubscribeCalls).toBe(1);
    refresh.resolve(createSnapshot("running"));
    await expect(reader!.read()).resolves.toMatchObject({ done: true });
    expect(eventBus.unsubscribeCalls).toBe(1);
  });

  it("unsubscribes exactly once when the response reader is canceled", async () => {
    const eventBus = new TrackingTranslationEventBus();
    const refresh = createDeferred<TranslationJobSnapshot | null>();
    let snapshotReads = 0;
    const handler = createTranslationJobEventsHandler({
      eventBus,
      readTranslationJobSnapshot: async () => {
        snapshotReads += 1;
        return snapshotReads === 1
          ? createSnapshot("running")
          : refresh.promise;
      },
    });

    const response = await handler(createEventsApiEvent("job-reader-canceled"));
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await expect(reader!.read()).resolves.toMatchObject({ done: false });
    expect(eventBus.subscribeCalls).toBe(1);

    await reader!.cancel();

    expect(eventBus.unsubscribeCalls).toBe(1);
    refresh.resolve(createSnapshot("running"));
    await Promise.resolve();
    expect(eventBus.unsubscribeCalls).toBe(1);
  });

  it("drops only an overflowing unread subscriber and allows bounded replay on reconnect", async () => {
    const eventBus = new TrackingTranslationEventBus();
    const handler = createTranslationJobEventsHandler({
      eventBus,
      readTranslationJobSnapshot: async () => createSnapshot("running"),
      sseLimits: { maxPendingBytes: 4_096, maxPendingEvents: 2 },
    });

    const response = await handler(createEventsApiEvent("job-slow-subscriber"));
    for (const text of ["first", "second", "third"]) {
      expect(() => eventBus.emit({
        chunkIndex: 0,
        data: { text },
        jobId: "job-slow-subscriber",
        langCode: "ja-JP",
        memoryId: "memory-terminal",
        type: "translation.codex.delta",
      })).not.toThrow();
    }

    expect(eventBus.unsubscribeCalls).toBe(1);
    await expect(response.body!.getReader().read()).rejects.toMatchObject({
      code: "event_limit_exceeded",
      kind: "sse_pending_events",
    });

    const reconnect = await handler(createEventsApiEvent("job-slow-subscriber"));
    const reconnectReader = reconnect.body!.getReader();
    await expect(readChunk(reconnectReader)).resolves.toContain(
      "translation.job.snapshot",
    );
    for (const text of ["first", "second", "third"]) {
      await expect(readChunk(reconnectReader)).resolves.toContain(
        `\"text\":\"${text}\"`,
      );
    }
    await reconnectReader.cancel();
    expect(eventBus.unsubscribeCalls).toBe(2);
  });

  it("drops an unread subscriber when its pending UTF-8 bytes overflow", async () => {
    const eventBus = new TrackingTranslationEventBus();
    const handler = createTranslationJobEventsHandler({
      eventBus,
      readTranslationJobSnapshot: async () => createSnapshot("running"),
      sseLimits: { maxPendingBytes: 1_024, maxPendingEvents: 128 },
    });
    const response = await handler(createEventsApiEvent("job-byte-overflow"));

    expect(() => eventBus.emit({
      chunkIndex: 0,
      data: { text: "界".repeat(512) },
      jobId: "job-byte-overflow",
      langCode: "ja-JP",
      memoryId: "memory-terminal",
      type: "translation.codex.delta",
    })).not.toThrow();

    expect(eventBus.unsubscribeCalls).toBe(1);
    await expect(response.body!.getReader().read()).rejects.toMatchObject({
      code: "event_limit_exceeded",
      kind: "sse_pending_bytes",
    });
  });

  it("does not eagerly walk bounded replay before the consumer pulls it", async () => {
    const eventBus = new LazyReplayTranslationEventBus();
    for (const text of ["first", "second"]) {
      eventBus.emit({
        chunkIndex: 0,
        data: { text },
        jobId: "job-lazy-replay",
        langCode: "ja-JP",
        memoryId: "memory-terminal",
        type: "translation.codex.delta",
      });
    }
    const handler = createTranslationJobEventsHandler({
      eventBus,
      readTranslationJobSnapshot: async () => createSnapshot("running"),
    });

    const response = await handler(createEventsApiEvent("job-lazy-replay"));
    expect(eventBus.secondReplayReads).toBe(0);

    const reader = response.body!.getReader();
    await expect(readChunk(reader)).resolves.toContain("translation.job.snapshot");
    await expect(readChunk(reader)).resolves.toContain("\"text\":\"first\"");
    await expect(readChunk(reader)).resolves.toContain("\"text\":\"second\"");
    expect(eventBus.secondReplayReads).toBe(1);
    await reader.cancel();
    expect(eventBus.unsubscribeCalls).toBe(1);
  });

  it("does not enqueue heartbeats while the consumer has no desired capacity", async () => {
    vi.useFakeTimers();
    try {
      const eventBus = new TrackingTranslationEventBus();
      const handler = createTranslationJobEventsHandler({
        eventBus,
        heartbeatIntervalMs: 10,
        readTranslationJobSnapshot: async () => createSnapshot("running"),
      });
      const response = await handler(createEventsApiEvent("job-heartbeat-backpressure"));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(30);

      const reader = response.body!.getReader();
      await expect(readChunk(reader)).resolves.toContain(
        "translation.job.snapshot",
      );
      let nextSettled = false;
      const next = reader.read().then((result) => {
        nextSettled = true;
        return result;
      });
      await Promise.resolve();
      expect(nextSettled).toBe(false);

      await vi.advanceTimersByTimeAsync(10);
      expect(decode((await next).value)).toContain(": keep-alive");
      await reader.cancel();
      expect(eventBus.unsubscribeCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

function createEventsApiEvent(jobId: string, signal?: AbortSignal): APIEvent {
  return {
    params: { jobId },
    request: new Request(
      `http://localhost/api/translation-jobs/${jobId}/events`,
      signal === undefined ? undefined : { signal },
    ),
  } as unknown as APIEvent;
}

class TrackingTranslationEventBus extends TranslationEventBus {
  subscribeCalls = 0;
  unsubscribeCalls = 0;

  override subscribeWithReplay(
    jobId: string,
    listener: Parameters<TranslationEventBus["subscribeWithReplay"]>[1],
  ): ReturnType<TranslationEventBus["subscribeWithReplay"]> {
    this.subscribeCalls += 1;
    const subscription = super.subscribeWithReplay(jobId, listener);
    let unsubscribed = false;
    return {
      replay: subscription.replay,
      unsubscribe: () => {
        if (unsubscribed) {
          return;
        }
        unsubscribed = true;
        this.unsubscribeCalls += 1;
        subscription.unsubscribe();
      },
    };
  }
}

class LazyReplayTranslationEventBus extends TrackingTranslationEventBus {
  secondReplayReads = 0;

  override subscribeWithReplay(
    jobId: string,
    listener: Parameters<TranslationEventBus["subscribeWithReplay"]>[1],
  ): ReturnType<TranslationEventBus["subscribeWithReplay"]> {
    const subscription = super.subscribeWithReplay(jobId, listener);
    const second = subscription.replay[1];
    if (second !== undefined) {
      Object.defineProperty(subscription.replay, 1, {
        configurable: true,
        enumerable: true,
        get: () => {
          this.secondReplayReads += 1;
          return second;
        },
      });
    }
    return subscription;
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolveValue = (_value: T): void => {
    throw new Error("Deferred promise was not initialized.");
  };
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}

function createSnapshot(status: string): TranslationJobSnapshot {
  return {
    chunk_count: 1,
    completed_chunks: 0,
    error: null,
    failed_chunks: 0,
    job_id: "job-terminal",
    lang_code: "ja-JP",
    memory_id: "memory-terminal",
    output_path: null,
    reader_url: null,
    retrying_chunks: 0,
    source_hash: "sha256:source",
    status,
  };
}

function decode(value: Uint8Array | undefined): string {
  return new TextDecoder().decode(value);
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const result = await reader.read();
  return decode(result.value);
}
