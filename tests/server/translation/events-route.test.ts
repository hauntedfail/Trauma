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
});

function createEventsApiEvent(jobId: string): APIEvent {
  return {
    params: { jobId },
    request: new Request(`http://localhost/api/translation-jobs/${jobId}/events`),
  } as unknown as APIEvent;
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
