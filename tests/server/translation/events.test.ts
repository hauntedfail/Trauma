import { describe, expect, it } from "vitest";

import {
  TRANSLATION_REPLAY_LIMITS,
  TranslationEventBus,
} from "../../../src/server/translation/events";

describe("TranslationEventBus", () => {
  it("keeps replay limits fixed at 500 events and 4 MiB", () => {
    expect(TRANSLATION_REPLAY_LIMITS).toEqual({
      maxReplayBytes: 4 * 1_024 * 1_024,
      maxReplayEvents: 500,
    });
  });

  it("evicts replay history by both event count and serialized UTF-8 bytes", () => {
    const sampleBus = new TranslationEventBus();
    const sample = sampleBus.emit({
      chunkIndex: 0,
      data: { text: "界".repeat(20) },
      jobId: "job-byte-bounded",
      langCode: "ja-JP",
      memoryId: "memory-byte-bounded",
      type: "translation.codex.delta",
    });
    const oneLargeEventBytes = Buffer.byteLength(
      JSON.stringify(sample),
      "utf8",
    );
    const byteBounded = new TranslationEventBus({
      maxReplayBytes: oneLargeEventBytes,
      maxReplayEvents: 500,
    });

    byteBounded.emit({
      chunkIndex: 0,
      data: { text: "small" },
      jobId: "job-byte-bounded",
      langCode: "ja-JP",
      memoryId: "memory-byte-bounded",
      type: "translation.codex.delta",
    });
    byteBounded.emit({
      chunkIndex: 0,
      data: { text: "界".repeat(20) },
      jobId: "job-byte-bounded",
      langCode: "ja-JP",
      memoryId: "memory-byte-bounded",
      type: "translation.codex.delta",
    });

    expect(byteBounded.getReplay("job-byte-bounded")).toEqual([
      expect.objectContaining({ data: { text: "界".repeat(20) } }),
    ]);

    const countBounded = new TranslationEventBus({
      maxReplayBytes: 1_000_000,
      maxReplayEvents: 2,
    });
    for (const text of ["first", "second", "third"]) {
      countBounded.emit({
        chunkIndex: 0,
        data: { text },
        jobId: "job-count-bounded",
        langCode: "ja-JP",
        memoryId: "memory-count-bounded",
        type: "translation.codex.delta",
      });
    }

    expect(countBounded.getReplay("job-count-bounded").map((event) => event.data))
      .toEqual([{ text: "second" }, { text: "third" }]);
  });

  it("notifies listeners of terminal events before pruning replay history", () => {
    const bus = new TranslationEventBus();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe("job-terminal", (event) => {
      seen.push(event.type);
    });

    bus.emit({
      chunkIndex: 0,
      data: { source_chunk_hash: "sha256:chunk" },
      jobId: "job-terminal",
      langCode: "ja-JP",
      memoryId: "memory-terminal",
      type: "translation.chunk.queued",
    });
    expect(bus.getReplay("job-terminal")).toHaveLength(1);

    bus.emit({
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
    unsubscribe();

    expect(seen).toEqual([
      "translation.chunk.queued",
      "translation.job.completed",
    ]);
    expect(bus.getReplay("job-terminal")).toEqual([]);
  });
});
