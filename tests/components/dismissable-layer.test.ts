import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dismissableLayerSource = readFileSync(
  "src/components/ui/dismissable-layer.ts",
  "utf8",
);
const taxonomyInlineCreateSource = readFileSync(
  "src/components/memories/TaxonomyInlineCreateControl.tsx",
  "utf8",
);

describe("dismissable popup layers", () => {
  it("suppresses the next outside click only after primary outside pointer dismissal", () => {
    expect(dismissableLayerSource).toContain("createEffect");
    expect(dismissableLayerSource).toContain("if (!isEnabled())");
    expect(dismissableLayerSource).not.toContain("onMount");
    expect(dismissableLayerSource).toContain(
      "options.shouldSuppressOutsideClick?.(event.target) ?? true",
    );
    expect(dismissableLayerSource).not.toContain("dismissAfterOutsideClick");
    expect(dismissableLayerSource).not.toContain("globalThis.setTimeout");
    expect(dismissableLayerSource).toContain('document.addEventListener("pointerdown"');
    expect(dismissableLayerSource).toContain("armOutsideClickSuppression");
    expect(dismissableLayerSource).toContain("handleSuppressedOutsideClick");
    expect(dismissableLayerSource).toContain("outsideClickSuppressionArmed");
    expect(dismissableLayerSource).toContain("once: true");
    expect(dismissableLayerSource).toContain("shouldSuppressOutsideClick");
    expect(dismissableLayerSource).toContain("isClickProducingPrimaryPointerDown");
    expect(dismissableLayerSource).toContain("event.button === 0");
    expect(dismissableLayerSource).toContain("event.isPrimary !== false");
    expect(dismissableLayerSource).toContain("event.preventDefault()");
    expect(dismissableLayerSource).toContain("event.stopImmediatePropagation()");
  });

  it("is shared by inline taxonomy creation controls", () => {
    expect(taxonomyInlineCreateSource).toContain("useDismissableLayer");
    expect(taxonomyInlineCreateSource).toContain("isEnabled: isOpen");
    expect(taxonomyInlineCreateSource).toContain("onDismiss: () => setOpen(false)");
  });
});
