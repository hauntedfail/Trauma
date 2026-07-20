import { describe, expect, it } from "vitest";

import { BoundedCache } from "../../../src/server/psychiatrist/bounded-cache";

describe("BoundedCache", () => {
  it("evicts the least recently used entry at its fixed capacity", () => {
    const cache = new BoundedCache<string, number>(2);
    cache.set("old", 1);
    cache.set("kept", 2);
    expect(cache.get("old")).toBe(1);

    cache.set("new", 3);

    expect(cache.get("kept")).toBeUndefined();
    expect(cache.get("old")).toBe(1);
    expect(cache.get("new")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("rejects invalid capacities", () => {
    expect(() => new BoundedCache(0)).toThrow("positive integer");
  });
});
