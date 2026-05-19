import { describe, expect, it } from "vitest";

import {
  validateTagName,
  normalizeTaxonomyName,
} from "../../src/taxonomy/name-policy";

describe("taxonomy name policy", () => {
  it("allows Unicode letters, numbers, hyphen, and underscore for tag names", () => {
    expect(validateTagName(" harness-engineering_2026 ").ok).toBe(true);
    expect(validateTagName("研究_2026").ok).toBe(true);
    expect(normalizeTaxonomyName(" test ")).toBe("test");
  });

  it("rejects tag names with unsafe separators or shell/path punctuation", () => {
    for (const name of ["has space", "../escape", "pipe|name", "semi;colon", ""]) {
      const result = validateTagName(name);
      expect(result).toMatchObject({ ok: false });
    }
  });
});
