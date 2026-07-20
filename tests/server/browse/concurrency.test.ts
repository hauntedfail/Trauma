import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "../../../src/server/browse/concurrency";

describe("browse bounded concurrency", () => {
  it("preserves input order without exceeding the worker limit", async () => {
    let active = 0;
    let maximumActive = 0;
    const release: (() => void)[] = [];

    const pending = mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
      return value * 10;
    });

    await waitFor(() => release.length === 2);
    while (release.length > 0) {
      release.shift()?.();
      await waitFor(() => release.length > 0 || active === 0);
    }

    await expect(pending).resolves.toEqual([10, 20, 30, 40, 50]);
    expect(maximumActive).toBe(2);
  });

  it("waits for remaining workers before surfacing a worker failure", async () => {
    const completed: number[] = [];

    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (value) => {
        if (value === 1) {
          throw new Error("worker failed");
        }
        await Promise.resolve();
        completed.push(value);
        return value;
      }),
    ).rejects.toThrow("worker failed");

    expect(completed).toEqual([2, 3]);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("timed out waiting for bounded browse work");
}
