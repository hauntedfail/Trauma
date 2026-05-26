import { describe, expect, it } from "vitest";

import { TranslationEventBus } from "../../../src/server/translation/events";

describe("TranslationEventBus", () => {
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
