import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { MomentActionMenu } from "../../src/components/moments/MomentActionMenu";

const momentActionMenuSource = readFileSync(
  "src/components/moments/MomentActionMenu.tsx",
  "utf8",
);

describe("Moment action menu", () => {
  it("renders the shared meetballs trigger and delete menu item", () => {
    const html = renderToString(() =>
      createComponent(MomentActionMenu, {
        momentId: "moment-1",
        sectionTitle: "Details",
        initialOpen: true,
      }),
    );

    expect(html).toContain('aria-label="Moment actions for Details"');
    expect(html).toContain("hover:bg-trauma-bg-elev");
    expect(html).toContain("Delete moment");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("text-trauma-danger");
    expect(html).toContain("M4 7h16");
  });

  it("uses the shared confirmation popup instead of a browser dialog", () => {
    expect(momentActionMenuSource).toContain("ConfirmationPopup");
    expect(momentActionMenuSource).not.toContain("window.confirm");
  });
});
