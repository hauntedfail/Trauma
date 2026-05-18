import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dismissableLayerSource = readFileSync(
  "src/components/ui/dismissable-layer.ts",
  "utf8",
);
const taxonomyCreatePopoverSource = readFileSync(
  "src/components/memories/TaxonomyCreatePopover.tsx",
  "utf8",
);

describe("dismissable popup layers", () => {
  it("suppresses the next outside click after outside pointer dismissal", () => {
    expect(dismissableLayerSource).toContain('document.addEventListener("pointerdown"');
    expect(dismissableLayerSource).toContain('document.addEventListener("click"');
    expect(dismissableLayerSource).toContain("suppressNextOutsideClick");
    expect(dismissableLayerSource).toContain("shouldSuppressOutsideClick");
    expect(dismissableLayerSource).toContain("event.preventDefault()");
    expect(dismissableLayerSource).toContain("event.stopImmediatePropagation()");
  });

  it("is shared by taxonomy creation popovers", () => {
    expect(taxonomyCreatePopoverSource).toContain("useDismissableLayer");
    expect(taxonomyCreatePopoverSource).toContain("shouldSuppressOutsideTaxonomyClick");
  });
});
