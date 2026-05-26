import { describe, expect, it } from "vitest";

import {
  buildMemoryAnchorHref,
  buildMemoryHref,
  buildMemoryVariantAnchorHref,
  buildSameMemoryAnchorHref,
} from "../../src/components/memories/memory-anchor-hrefs";

describe("memory anchor hrefs", () => {
  it("builds memory routes with optional section or flashback anchors", () => {
    expect(buildMemoryHref("018f04a2-3c6f-7c88-9a8b-8c99a9b7f101")).toBe(
      "/memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f101",
    );
    expect(
      buildMemoryAnchorHref({
        anchorId: "details",
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101",
      }),
    ).toBe("/memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f101#details");
  });

  it("encodes path and hash segments independently", () => {
    expect(
      buildMemoryAnchorHref({
        anchorId: "section with spaces",
        memoryId: "memory with spaces",
      }),
    ).toBe("/memories/memory%20with%20spaces#section%20with%20spaces");
    expect(buildSameMemoryAnchorHref("flashback with spaces")).toBe(
      "#flashback%20with%20spaces",
    );
  });

  it("builds translated memory routes with optional anchors", () => {
    expect(
      buildMemoryVariantAnchorHref({
        anchorId: "translated flashback",
        langCode: "ja-JP",
        memoryId: "memory with spaces",
      }),
    ).toBe("/memories/ja-JP/memory%20with%20spaces#translated%20flashback");
    expect(
      buildMemoryVariantAnchorHref({
        langCode: null,
        memoryId: "memory with spaces",
      }),
    ).toBe("/memories/memory%20with%20spaces");
  });
});
