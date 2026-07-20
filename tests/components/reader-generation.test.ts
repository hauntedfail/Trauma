import { describe, expect, it } from "vitest";

import { createReaderGenerationGuard } from "../../src/components/reader/reader-generation";

describe("reader generation guard", () => {
  it("rejects an async continuation after the reader identity changes", async () => {
    const guard = createReaderGenerationGuard({
      memoryId: "memory-a",
      langCode: undefined,
    });
    const readerA = guard.capture();
    const pending = createDeferred<string>();
    const mutations: string[] = [];

    const continuation = pending.promise.then((value) => {
      if (guard.isCurrent(readerA)) {
        mutations.push(value);
      }
    });

    const readerB = guard.activate({
      memoryId: "memory-b",
      langCode: "ja-JP",
    });
    pending.resolve("stale-reader-a-result");
    await continuation;

    expect(readerB.generation).toBeGreaterThan(readerA.generation);
    expect(guard.isCurrent(readerA)).toBe(false);
    expect(guard.isCurrent(readerB)).toBe(true);
    expect(mutations).toEqual([]);
  });

  it("keeps the same generation for refreshes of one reader identity", () => {
    const guard = createReaderGenerationGuard({
      memoryId: "memory-a",
      langCode: undefined,
    });
    const initial = guard.capture();
    const refreshed = guard.activate({
      memoryId: "memory-a",
      langCode: undefined,
    });

    expect(refreshed).toEqual(initial);
    expect(guard.isCurrent(refreshed)).toBe(true);
  });

  it("starts a new generation when the active language variant changes", () => {
    const guard = createReaderGenerationGuard({
      memoryId: "memory-a",
      langCode: undefined,
    });
    const source = guard.capture();
    const translation = guard.activate({
      memoryId: "memory-a",
      langCode: "ja-JP",
    });

    expect(translation.generation).toBeGreaterThan(source.generation);
    expect(guard.isCurrent(source)).toBe(false);
    expect(guard.isCurrent(translation)).toBe(true);
  });

  it("invalidates pending continuations during component cleanup", () => {
    const guard = createReaderGenerationGuard({
      memoryId: "memory-a",
      langCode: undefined,
    });
    const pending = guard.capture();

    guard.invalidate();

    expect(guard.isCurrent(pending)).toBe(false);
  });
});

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}
