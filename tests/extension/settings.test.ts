import { describe, expect, it } from "vitest";

import { normalizeTraumaUrl } from "../../extensions/browser/src/settings";

describe("extension settings", () => {
  it("accepts localhost and 127.0.0.1 with explicit ports", () => {
    expect(normalizeTraumaUrl("http://localhost:3000/")).toEqual({
      ok: true,
      value: "http://localhost:3000",
    });
    expect(normalizeTraumaUrl("http://127.0.0.1:63821")).toEqual({
      ok: true,
      value: "http://127.0.0.1:63821",
    });
  });

  it("rejects non-local instance addresses", () => {
    expect(normalizeTraumaUrl("https://example.com")).toEqual({
      ok: false,
      error: "TRAUMA URL must use localhost or 127.0.0.1.",
    });
  });
});
