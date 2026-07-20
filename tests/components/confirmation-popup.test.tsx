import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { ConfirmationPopup } from "../../src/components/ui/ConfirmationPopup";

const confirmationPopupSource = readFileSync(
  "src/components/ui/ConfirmationPopup.tsx",
  "utf8",
);

describe("confirmation popup", () => {
  it("renders a labelled shared dialog with explicit cancel and confirm actions", () => {
    const html = renderToString(() =>
      createComponent(ConfirmationPopup, {
        confirmLabel: "Delete item",
        description: "Delete this item?",
        id: "delete-item-confirmation",
        initialOpen: true,
        label: "Delete item confirmation",
        onConfirm: () => true,
        trigger: ({ triggerProps }) => (
          <button {...triggerProps} type="button">Delete item</button>
        ),
      }),
    );

    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Delete item confirmation"');
    expect(html).toContain(
      'aria-describedby="delete-item-confirmation-description"',
    );
    expect(html).toContain("Delete this item?");
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain(">Delete item</button>");
  });

  it("routes Cancel, Escape, and outside dismissal through Popup close reset", () => {
    expect(confirmationPopupSource).toContain("<Popup");
    expect(confirmationPopupSource).toContain("onClose={resetConfirmation}");
    expect(confirmationPopupSource).toContain("confirmationAttempt += 1");
    expect(confirmationPopupSource).toContain("onClick={close}");
    expect(confirmationPopupSource).not.toContain("window.confirm");
  });
});
