import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readerSource = readFileSync("src/components/reader/MemoryReader.tsx", "utf8");
const readerStyles = readFileSync("src/components/reader/reader-styles.ts", "utf8");
const readerRoute = readFileSync("src/routes/memories/[id].tsx", "utf8");
const tailwindSource = readFileSync("src/styles/tailwind.css", "utf8");
const combinedSource = [readerSource, readerStyles, readerRoute].join("\n");

describe("refined reader visual contract", () => {
  it("uses TRAUMA design tokens instead of legacy reader palette utilities", () => {
    expect(combinedSource).toContain("text-trauma-text-primary");
    expect(combinedSource).toContain("bg-trauma-bg-surface");
    expect(combinedSource).toContain("prose-mark:bg-trauma-flashback-bg");
    expect(combinedSource).toContain("trauma-reader-content");
    expect(combinedSource).toContain("prose-a:text-trauma-link");
    expect(combinedSource).not.toMatch(/text-slate|border-slate|bg-slate|text-blue|bg-white|yellow-/);
  });

  it("keeps safe source-link rendering and read-only flashback toggles", () => {
    expect(readerSource).toContain("toSafeReaderSourceHref");
    expect(readerSource).toContain("data-reader-content");
    expect(readerSource).toContain("toggleReaderSelection");
    expect(readerSource).toContain("text-trauma-link");
    expect(readerSource).toContain('aria-label="Memory"');
    expect(readerSource).toContain("RouteHeader");
    expect(readerSource).toContain('title="Memory"');
    expect(readerSource).toContain('titleElement="p"');
    expect(readerSource).not.toContain(">Reader mode</p>");
    expect(readerSource).not.toContain("props.result.memory.title}</h1>");
    expect(readerSource).not.toContain("contenteditable");
  });

  it("uses tighter reader-only main pane padding", () => {
    expect(readerStyles).toContain('readerPadding = "trauma-reader-route-padding"');
    expect(readerStyles).not.toContain("px-8");
    expect(tailwindSource).toContain(".trauma-reader-route-padding");
    expect(tailwindSource).toContain("padding-inline: clamp(0.75rem, 2.5cqi, 1.25rem)");
  });

  it("aligns the memory source URL with the reader action menu row", () => {
    expect(readerSource).toContain("readerSourceLinkClass");
    expect(readerSource).toContain("inline-flex min-h-9 items-center");
    expect(readerSource).toContain("grid-cols-[minmax(0,1fr)_auto] items-center gap-4");
    expect(readerSource).toContain('class="flex items-center gap-2"');
    expect(readerSource).not.toContain("grid-cols-[minmax(0,1fr)_auto] items-start gap-4");
    expect(readerSource).not.toContain('class="flex items-start gap-2"');
  });

  it("moves the reader table of contents into the contextual right rail", () => {
    expect(readerSource).toContain("useRightRailContent");
    expect(readerSource).toContain("onCleanup");
    expect(readerSource).toContain("animate-trauma-pop-bounce");
    expect(readerSource).toContain("readerTocScrollContent");
    expect(readerSource).not.toContain(
      "grid-cols-[minmax(160px,220px)_minmax(0,1fr)]",
    );
  });

  it("keeps the reader table of contents bounded inside its own scroll body", () => {
    expect(readerSource).toContain("max-h-[min(44vh,24rem)]");
    expect(readerSource).toContain("overflow-y-auto");
    expect(readerSource).toContain("overscroll-contain");
  });

  it("shows subtle top and bottom blur fades only when the reader TOC can scroll in that direction", () => {
    expect(readerSource).toContain("tocScrollState");
    expect(readerSource).toContain("updateTocScrollHint");
    expect(readerSource).toContain("scrollHeight");
    expect(readerSource).toContain("clientHeight");
    expect(readerSource).toContain("scrollTop");
    expect(readerSource).toContain("canScrollUp");
    expect(readerSource).toContain("canScrollDown");
    expect(readerSource).toContain("trauma-toc-scroll-shell");
    expect(readerSource).toContain("trauma-toc-scroll-fade");
    expect(readerSource).toContain("trauma-toc-scroll-fade-top");
    expect(readerSource).toContain("trauma-toc-scroll-fade-bottom");
    expect(readerSource).toContain("pl-0");
    expect(readerSource).not.toContain("pl-[18px]");
    expect(readerSource).toContain("grid-cols-[1.125rem_minmax(0,1fr)]");
    expect(readerSource).toContain(
      "animate-trauma-pop-bounce relative overflow-hidden rounded-[20px]",
    );
    expect(readerSource).toContain('class="trauma-toc-scroll-shell"');
    expect(readerSource).not.toContain('class="trauma-toc-scroll-shell relative"');
    expect(readerSource).toContain("onScroll={updateTocScrollHint}");
    expect(tailwindSource).toContain(".trauma-toc-scroll-fade");
    expect(tailwindSource).toContain(".trauma-toc-scroll-fade-top");
    expect(tailwindSource).toContain(".trauma-toc-scroll-fade-bottom");
    expect(tailwindSource).toContain("backdrop-filter: blur(");
    expect(tailwindSource).toContain("top: 4rem");
    expect(tailwindSource).toContain("mask-image: linear-gradient");

    const fadeStart = tailwindSource.indexOf(".trauma-toc-scroll-fade");
    const nextRuleStart = tailwindSource.indexOf(
      ':root[data-theme^="paper"] .trauma-paper-wax-seal',
      fadeStart,
    );
    const fadeRule = tailwindSource.slice(fadeStart, nextRuleStart);

    expect(fadeRule).toContain("rgb(0 0 0 /");
    expect(fadeRule).not.toContain("box-shadow");
    expect(fadeRule).not.toContain("radial-gradient");
    expect(fadeRule).not.toContain("var(--accent)");
  });

  it("gives linked flashback anchors a target-specific contrast treatment", () => {
    expect(tailwindSource).toContain("--anchor-flashback-bg");
    expect(tailwindSource).toContain("--anchor-flashback-ink");
    expect(tailwindSource).toContain("--anchor-flashback-ring");
    expect(tailwindSource).toContain(
      ".trauma-reader-content mark[data-flashback-id]:target",
    );
    expect(tailwindSource).toContain(
      "background-color: var(--anchor-flashback-bg)",
    );
    expect(tailwindSource).toContain("color: var(--anchor-flashback-ink)");
    expect(tailwindSource).toContain("var(--anchor-flashback-ring)");
    expect(tailwindSource).toContain("scroll-margin-block");
  });

  it("defines a reduced-motion-safe pop bounce animation for reader TOC entry", () => {
    expect(tailwindSource).toContain("@keyframes trauma-pop-bounce");
    expect(tailwindSource).toContain(".animate-trauma-pop-bounce");
    expect(tailwindSource).toContain("prefers-reduced-motion: reduce");
  });
});
