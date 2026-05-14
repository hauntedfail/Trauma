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
    expect(combinedSource).toContain("prose-mark:bg-trauma-highlight-bg");
    expect(combinedSource).toContain("trauma-reader-content");
    expect(combinedSource).toContain("prose-a:text-trauma-link");
    expect(combinedSource).not.toMatch(/text-slate|border-slate|bg-slate|text-blue|bg-white|yellow-/);
  });

  it("keeps safe source-link rendering and read-only highlight toggles", () => {
    expect(readerSource).toContain("toSafeReaderSourceHref");
    expect(readerSource).toContain("data-reader-content");
    expect(readerSource).toContain("toggleReaderSelection");
    expect(readerSource).toContain("text-trauma-link");
    expect(readerSource).toContain('aria-label="Memory"');
    expect(readerSource).toContain(">Memory</p>");
    expect(readerSource).not.toContain(">Reader mode</p>");
    expect(readerSource).not.toContain("props.result.memory.title}</h1>");
    expect(readerSource).not.toContain("contenteditable");
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

  it("shows a subtle bottom spotlight when the reader TOC can scroll further", () => {
    expect(readerSource).toContain("showTocScrollHint");
    expect(readerSource).toContain("updateTocScrollHint");
    expect(readerSource).toContain("scrollHeight");
    expect(readerSource).toContain("clientHeight");
    expect(readerSource).toContain("scrollTop");
    expect(readerSource).toContain("trauma-toc-scroll-shell");
    expect(readerSource).toContain("trauma-toc-scroll-spotlight");
    expect(readerSource).toContain(
      "animate-trauma-pop-bounce relative overflow-hidden rounded-[20px]",
    );
    expect(readerSource).toContain('class="trauma-toc-scroll-shell"');
    expect(readerSource).not.toContain('class="trauma-toc-scroll-shell relative"');
    expect(readerSource).toContain("onScroll={updateTocScrollHint}");
    expect(tailwindSource).toContain(".trauma-toc-scroll-spotlight");
    expect(tailwindSource).toContain("radial-gradient(ellipse at 50% 100%");

    const spotlightStart = tailwindSource.indexOf(".trauma-toc-scroll-spotlight");
    const nextRuleStart = tailwindSource.indexOf(
      ':root[data-theme^="paper"] .trauma-paper-wax-seal',
      spotlightStart,
    );
    const spotlightRule = tailwindSource.slice(spotlightStart, nextRuleStart);

    expect(spotlightRule).toContain("rgb(0 0 0 /");
    expect(spotlightRule).not.toContain("var(--accent)");
  });

  it("gives linked highlight anchors a target-specific contrast treatment", () => {
    expect(tailwindSource).toContain("--anchor-highlight-bg");
    expect(tailwindSource).toContain("--anchor-highlight-ink");
    expect(tailwindSource).toContain("--anchor-highlight-ring");
    expect(tailwindSource).toContain(
      ".trauma-reader-content mark[data-highlight-id]:target",
    );
    expect(tailwindSource).toContain(
      "background-color: var(--anchor-highlight-bg)",
    );
    expect(tailwindSource).toContain("color: var(--anchor-highlight-ink)");
    expect(tailwindSource).toContain("var(--anchor-highlight-ring)");
    expect(tailwindSource).toContain("scroll-margin-block");
  });

  it("defines a reduced-motion-safe pop bounce animation for reader TOC entry", () => {
    expect(tailwindSource).toContain("@keyframes trauma-pop-bounce");
    expect(tailwindSource).toContain(".animate-trauma-pop-bounce");
    expect(tailwindSource).toContain("prefers-reduced-motion: reduce");
  });
});
