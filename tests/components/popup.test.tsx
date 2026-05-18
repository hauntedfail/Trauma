import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { Popup } from "../../src/components/ui/Popup";

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

  it("owns shared popup chrome and close interactions", () => {
    expect(popupSource).toContain("useDismissableLayer");
    expect(popupSource).toContain("shouldSuppressPopupOutsideClick");
    expect(popupSource).toContain("[data-popup-dismiss-only]");
    expect(popupSource).not.toContain("a,[data-popup-dismiss-only]");
    expect(popupSource).toContain("rounded-[20px]");
    expect(popupSource).toContain("animate-trauma-pop-bounce");
    expect(popupSource).toContain("shadow-trauma-2");
  });
});
