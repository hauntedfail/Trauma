import { describe, expect, it } from "vitest";

import { getMemoryReaderStatusCode } from "../../src/routes/memories/reader-status";

describe("memory reader route status", () => {
  it("returns 404 when the requested memory is missing", () => {
    expect(getMemoryReaderStatusCode(undefined)).toBe(404);
  });

  it("does not override status when the requested memory exists", () => {
    expect(getMemoryReaderStatusCode({ id: "memory-foundation" })).toBeUndefined();
  });
});
