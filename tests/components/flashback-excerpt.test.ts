import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { FlashbackExcerpt } from "../../src/components/flashbacks/FlashbackExcerpt";
import { FlashbackShortcutList } from "../../src/components/flashbacks/FlashbackShortcutList";

describe("Flashback excerpt rendering", () => {
  it("renders selected text with lower-contrast context around it", () => {
    const html = renderToString(() =>
      createComponent(FlashbackExcerpt, {
        prefix: "before ",
        text: "selected text",
        suffix: " after",
      }),
    );

    expect(html).toContain("before ");
    expect(html).toContain("selected text");
    expect(html).toContain(" after");
    expect(html).toContain("text-trauma-text-muted");
    expect(html).toContain("font-bold text-trauma-text-primary");
  });

  it("wraps shortcut lists with scroll-edge fade hooks", () => {
    const html = renderToString(() =>
      createComponent(FlashbackShortcutList, {
        emptyLabel: "No flashbacks",
        flashbacks: [
          {
            id: "flashback-1",
            prefix: "before ",
            suffix: " after",
            text: "selected",
          },
        ],
      }),
    );

    expect(html).toContain("relative overflow-hidden");
    expect(html).toContain("before ");
    expect(html).toContain("selected");
    expect(html).toContain(" after");
    expect(html).not.toContain("<blockquote");
  });
});
