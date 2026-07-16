import type { APIEvent } from "@solidjs/start/server";
import { describe, expect, it } from "vitest";

import { TranslationEventBus } from "../../../src/server/translation/events";
import { createTranslationJobEventsHandler } from "../../../src/server/translation/events-route";
import type { TranslationJobSnapshot } from "../../../src/server/translation/runner";

describe("translation job events route", () => {
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
