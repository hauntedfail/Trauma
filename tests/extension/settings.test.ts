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

  it("normalizes copied app page URLs to the instance origin", () => {
    expect(normalizeTraumaUrl("http://127.0.0.1:3000/memories?view=grid#top"))
      .toEqual({
        ok: true,
        value: "http://127.0.0.1:3000",
      });
  });

  it("rejects non-local instance addresses", () => {
    expect(normalizeTraumaUrl("http://example.com")).toEqual({
      ok: false,
      error: "TRAUMA URL must use localhost or 127.0.0.1.",
    });
  });

  it("rejects HTTPS loopback URLs that are outside extension permissions", () => {
    expect(normalizeTraumaUrl("https://localhost:3000")).toEqual({
      ok: false,
      error: "TRAUMA URL must use http.",
    });
  });
});
