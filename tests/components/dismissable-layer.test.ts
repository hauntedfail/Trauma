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
const popupSource = readFileSync("src/components/ui/Popup.tsx", "utf8");
const sheetSource = readFileSync("src/components/ui/Sheet.tsx", "utf8");
const memoryReaderSource = readFileSync(
  "src/components/reader/MemoryReader.tsx",
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
    expect(dismissableLayerSource).toContain("outsideClickSuppressionPointerId");
    expect(dismissableLayerSource).toContain("clearOutsideClickSuppression");
    expect(dismissableLayerSource).toContain("handleSuppressedPointerCancel");
    expect(dismissableLayerSource).toContain("handleSuppressedPointerUp");
    expect(dismissableLayerSource).toContain("handleInterruptedPointerDown");
    expect(dismissableLayerSource).toContain('"pointercancel",');
    expect(dismissableLayerSource).toContain('window.addEventListener("blur"');
    expect(dismissableLayerSource).toContain("window.setTimeout");
    expect(dismissableLayerSource).toContain("once: true");
    expect(dismissableLayerSource).toContain("shouldSuppressOutsideClick");
    expect(dismissableLayerSource).toContain("isClickProducingPrimaryPointerDown");
    expect(dismissableLayerSource).toContain("event.button === 0");
    expect(dismissableLayerSource).toContain("event.isPrimary !== false");
    expect(dismissableLayerSource).toContain("event.preventDefault()");
    expect(dismissableLayerSource).toContain("event.stopImmediatePropagation()");
  });

  it("dismisses only the topmost active layer", () => {
    expect(dismissableLayerSource).toContain("activeLayerIds");
    expect(dismissableLayerSource).toContain("isTopmostLayer");
    expect(dismissableLayerSource).toContain("activeLayerIds.at(-1) === layerId");
    expect(dismissableLayerSource).toContain('event.key === "Escape" && isTopmostLayer()');
  });

  it("is shared by inline taxonomy creation controls", () => {
    expect(taxonomyInlineCreateSource).toContain("useDismissableLayer");
    expect(taxonomyInlineCreateSource).toContain("isEnabled: isOpen");
    expect(taxonomyInlineCreateSource).toContain(
      "onDismiss: (reason) => setOpen(false, reason)",
    );
  });

  it("combines Kobalte Popover positioning with shared dismissable-layer contracts and delegates the Psychiatrist sheet to Corvu Drawer", () => {
    expect(popupSource).toContain('import { Popover } from "@kobalte/core/popover"');
    expect(popupSource).toContain("useDismissableLayer");
    expect(popupSource).toContain("shouldIgnoreOutsidePointerDown");
    expect(popupSource).toContain("onEscapeKeyDown");
    expect(popupSource).toContain("onPointerDownOutside");

    expect(memoryReaderSource).toContain("<TraumaSheet");
    expect(memoryReaderSource).toContain('id="reader-psychiatrist-sheet"');
    expect(memoryReaderSource).not.toContain("useDismissableLayer");

    expect(sheetSource).toContain('import Drawer from "@corvu/drawer"');
    expect(sheetSource).toContain("trapFocus={false}");
    expect(sheetSource).toContain("restoreFocus={false}");
    expect(sheetSource).toContain("closeOnEscapeKeyDown={true}");
    expect(sheetSource).toContain("closeOnOutsidePointer={false}");
    expect(sheetSource).toContain("closeOnOutsideFocus={false}");
    expect(sheetSource).toContain('role="dialog"');
  });
});
