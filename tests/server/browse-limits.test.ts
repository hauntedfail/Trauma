import { describe, expect, it } from "vitest";

import {
  MAX_BROWSE_RESULT_LIMIT,
  normalizeBrowseLimit,
} from "../../src/server/browse/limits";

describe("browse limits", () => {
  it("normalizes browse result limits with a shared upper cap", () => {
    expect(normalizeBrowseLimit(Number.NaN)).toBe(1);
    expect(normalizeBrowseLimit(0)).toBe(1);
    expect(normalizeBrowseLimit(12.8)).toBe(12);
    expect(normalizeBrowseLimit(MAX_BROWSE_RESULT_LIMIT)).toBe(
      MAX_BROWSE_RESULT_LIMIT,
    );
    expect(normalizeBrowseLimit(MAX_BROWSE_RESULT_LIMIT + 1)).toBe(
      MAX_BROWSE_RESULT_LIMIT,
    );
  });
});
