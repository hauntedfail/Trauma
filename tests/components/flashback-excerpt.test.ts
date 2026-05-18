import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { FlashbackExcerpt } from "../../src/components/flashbacks/FlashbackExcerpt";
import { FlashbackShortcutList } from "../../src/components/flashbacks/FlashbackShortcutList";

const tailwindCss = readFileSync("src/styles/tailwind.css", "utf8");

describe("Flashback excerpt rendering", () => {
  it("renders selected text with blurred context around it", () => {
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
    expect(html).toContain("trauma-flashback-context-before");
    expect(html).toContain("trauma-flashback-context-after");
    expect(html).toContain("font-bold text-trauma-text-primary");
  });

  it("renders shortcut list item context without component-level fade hooks", () => {
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

    expect(html).toContain("before ");
    expect(html).toContain("selected");
    expect(html).toContain(" after");
    expect(html).toContain("trauma-flashback-context-before");
    expect(html).toContain("trauma-flashback-context-after");
    expect(html).not.toContain("trauma-toc-scroll-fade");
    expect(html).not.toContain("<blockquote");
  });

  it("keeps Flashback context blur scoped to prefix and suffix text", () => {
    expect(tailwindCss).toContain(".trauma-flashback-context");
    expect(tailwindCss).toContain("filter: blur(");
    expect(tailwindCss).toContain(".trauma-flashback-context-before");
    expect(tailwindCss).toContain(".trauma-flashback-context-after");
    expect(tailwindCss).toContain("mask-image: linear-gradient");
  });
});
