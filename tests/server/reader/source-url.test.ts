import { describe, expect, it } from "vitest";

import { toSafeReaderSourceHref } from "../../../src/components/reader/source-url";

describe("toSafeReaderSourceHref", () => {
  it("keeps http and https memory source URLs clickable", () => {
    expect(toSafeReaderSourceHref("https://example.com/reader")).toBe(
      "https://example.com/reader",
    );
    expect(toSafeReaderSourceHref("http://example.com/reader")).toBe(
      "http://example.com/reader",
    );
  });

  it("rejects source URL schemes that should not become reader hrefs", () => {
    expect(toSafeReaderSourceHref("javascript:alert(1)")).toBeUndefined();
    expect(toSafeReaderSourceHref("data:text/html,hello")).toBeUndefined();
    expect(toSafeReaderSourceHref("not a url")).toBeUndefined();
  });
});
