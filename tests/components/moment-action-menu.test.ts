import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  confirmAndDeleteMoment,
  MomentActionMenu,
} from "../../src/components/moments/MomentActionMenu";

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
  });

  it("asks for confirmation before deleting", async () => {
    const calls: string[] = [];
    const deleted = await confirmAndDeleteMoment({
      momentId: "moment-1",
      sectionTitle: "Details",
      confirm: (message) => {
        calls.push(message);
        return true;
      },
      onDelete: (momentId) => {
        calls.push(momentId);
      },
    });

    expect(deleted).toBe(true);
    expect(calls).toEqual([
      'Delete moment "Details"?',
      "moment-1",
    ]);
  });
});
