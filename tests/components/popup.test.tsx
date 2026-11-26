import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { TraumaDialog } from "../../src/components/ui/Dialog";
import { Popup } from "../../src/components/ui/Popup";
import { TraumaSheet } from "../../src/components/ui/Sheet";

const popupSource = readFileSync("src/components/ui/Popup.tsx", "utf8");

describe("popup shell", () => {
  it("renders trigger state and dialog content when initially open", () => {
    const html = renderToString(() =>
      createComponent(Popup, {
        id: "test-popup",
        initialOpen: true,
        label: "Test popup",
        mode: "dialog",
        trigger: ({ open, triggerProps }) => (
          <button {...triggerProps} type="button">
            {open ? "Open" : "Closed"}
          </button>
        ),
        children: () => <p>Popup body</p>,
      }),
    );

    expect(html).toContain('aria-controls="test-popup"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Popup body");
  });

  it("renders menu role for menu mode", () => {
    const html = renderToString(() =>
      createComponent(Popup, {
        id: "test-menu",
        initialOpen: true,
        label: "Test menu",
        mode: "menu",
        trigger: ({ triggerProps }) => (
          <button {...triggerProps} type="button">
            Menu
          </button>
        ),
        children: () => <button type="button">Action</button>,
      }),
    );

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('role="menu"');
  });

  it("owns shared popup chrome, Kobalte popover positioning, and dismissable-layer close contracts", () => {
    expect(popupSource).toContain('import { Popover } from "@kobalte/core/popover"');
    expect(popupSource).toContain("<Popover.Anchor");
    expect(popupSource).toContain("<Popover.Portal>");
    expect(popupSource).toContain("<Popover.Content");
    expect(popupSource).toContain("when={!isServer}");
    expect(popupSource).toContain("useDismissableLayer");
    expect(popupSource).toContain("shouldIgnoreOutsidePointerDown");
    expect(popupSource).toContain("onEscapeKeyDown");
    expect(popupSource).toContain("onPointerDownOutside");
    expect(popupSource).toContain("onFocusOutside");
    expect(popupSource).toContain("onInteractOutside");
    expect(popupSource).toContain("onOpenAutoFocus");
    expect(popupSource).toContain("onCloseAutoFocus");
    expect(popupSource).toContain("rootRef.contains(target)");
    expect(popupSource).toContain("untrack(() => props.onOpenChange?.(nextOpen))");
    expect(popupSource).toContain("untrack(() => props.onClose?.())");
    expect(popupSource).not.toContain("shouldSuppressPopupOutsideClick");
    expect(popupSource).not.toContain("isPopupActionTarget");
    expect(popupSource).not.toContain("[data-popup-dismiss-only]");
    expect(popupSource).toContain("trauma-ui-popover");
    expect(popupSource).toContain("rounded-2xl");
    expect(popupSource).toContain("bg-trauma-bg-elev/95");
    expect(popupSource).toContain("backdrop-blur-xl");
    expect(popupSource).toContain("ring-1");
  });

  it("owns focus transfer, focus return, nested popover focus retention, and the menu keyboard model", () => {
    expect(popupSource).toContain("focusPopupPanel");
    expect(popupSource).toContain("focusConnectedPopupTrigger");
    expect(popupSource).toContain("restorePopupTriggerFocus");
    expect(popupSource).toContain('event.key === "ArrowDown"');
    expect(popupSource).toContain('event.key === "ArrowUp"');
    expect(popupSource).toContain('event.key === "Home"');
    expect(popupSource).toContain('event.key === "End"');
    expect(popupSource).toContain('event.key !== "Tab" || !event.shiftKey');
    expect(popupSource).toContain("PopupParentContext");
    expect(popupSource).toContain("hasOpenChildPopup");
    expect(popupSource).toContain("onChildDismissedOutside");
    expect(popupSource).toContain("closePopup(true)");
    expect(popupSource).toContain("panel.contains(event.relatedTarget)");
    expect(popupSource).not.toContain("rootRef?.contains(event.relatedTarget)");
    expect(popupSource).toContain('as="div"');
    expect(popupSource).toContain("ref={rootRef}");
    expect(popupSource).not.toContain("<span ref={rootRef}");
  });

  it("renders TraumaDialog and TraumaSheet cleanly during SSR without DOM globals", () => {
    expect(() =>
      renderToString(() =>
        createComponent(TraumaDialog, {
          ariaLabel: "SSR dialog",
          id: "ssr-dialog",
          onOpenChange: () => {},
          open: false,
          children: <p>Dialog body</p>,
        }),
      ),
    ).not.toThrow();

    expect(() =>
      renderToString(() =>
        createComponent(TraumaSheet, {
          ariaLabel: "SSR sheet",
          id: "ssr-sheet",
          onOpenChange: () => {},
          open: false,
          children: <p>Sheet body</p>,
        }),
      ),
    ).not.toThrow();
  });
});
