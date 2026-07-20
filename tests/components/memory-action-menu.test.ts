import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { MemoryActionMenu } from "../../src/components/memories/MemoryActionMenu";

const memoryActionMenuSource = readFileSync(
  "src/components/memories/MemoryActionMenu.tsx",
  "utf8",
);

describe("memory action menu", () => {
  it("renders an accessible trigger and required menu items", () => {
    const html = renderToString(() =>
      createComponent(MemoryActionMenu, {
        memoryId: "memory-1",
        memoryTitle: "Memory One",
        initialOpen: true,
      }),
    );

    expect(html).toContain('aria-label="Memory actions for Memory One"');
    expect(html).toContain("Delete memory");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Add category");
    expect(html).toContain("text-trauma-danger");
    expect(html).toContain("M4 7h16");
  });

  it("renders a shared trigger with visible hover affordance", () => {
    const html = renderToString(() =>
      createComponent(MemoryActionMenu, {
        memoryId: "memory-1",
        memoryTitle: "Memory One",
      }),
    );

    expect(html).toContain("hover:bg-trauma-bg-elev");
    expect(html).toContain("hover:text-trauma-text-primary");
  });

  it("uses the shared confirmation popup instead of a browser dialog", () => {
    expect(memoryActionMenuSource).toContain("ConfirmationPopup");
    expect(memoryActionMenuSource).not.toContain("window.confirm");
  });
});
