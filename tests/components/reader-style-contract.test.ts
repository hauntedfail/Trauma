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
    expect(readerSource).toContain("ScrollableUrlDisplay");
    expect(readerSource).toContain("ScrollableUrlLink");
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

  it("uses measure-bound centered reader canvas and tighter reader-only padding", () => {
    expect(readerStyles).toContain('readerPadding = "trauma-reader-route-padding"');
    expect(readerStyles).toContain('readerColumn = "trauma-reader-column min-w-0"');
    expect(readerStyles).not.toContain("px-8");
    expect(tailwindSource).toContain("--reader-measure: 66ch");
    expect(tailwindSource).toContain(".trauma-reader-column");
    expect(tailwindSource).toContain(
      "inline-size: min(100%, var(--reader-measure, 66ch))",
    );
    expect(tailwindSource).toContain(".trauma-reader-column:lang(ja)");
    expect(tailwindSource).toContain("--reader-measure: 40ic");
    expect(tailwindSource).toContain(".trauma-reader-column:lang(ko)");
    expect(tailwindSource).toContain("--reader-measure: 42ic");
    expect(tailwindSource).toContain(".trauma-reader-route-padding");
    expect(tailwindSource).toContain("padding-inline: clamp(0.5rem, 2cqi, 1rem)");
    expect(tailwindSource).toContain("padding-inline: 0.75rem");
    expect(readerSource).toContain("trauma-reader-body py-6 pb-12");
    expect(readerSource).toContain("data-reader-column");
  });

  it("renders auto-hiding topbar with Translate and Details popovers, left landmark rail, on-demand Psychiatrist sheet, and quiet end footer without useRightRailContent or Inspector drawer", () => {
    expect(readerSource).not.toContain("useRightRailContent");
    expect(readerSource).not.toContain("reader-inspector-dialog");
    expect(readerSource).not.toContain("data-reader-inspector");
    expect(readerSource).toContain("data-reader-topbar");
    expect(readerSource).toContain("data-topbar-hidden");
    expect(readerSource).toContain("data-reader-translate-trigger");
    expect(readerSource).toContain("data-reader-details-trigger");
    expect(readerSource).toContain('aria-label="Memory details and actions"');
    expect(readerSource).toContain("data-reader-landmark-rail");
    expect(readerSource).toContain("data-reader-landmark-marks");
    expect(readerSource).toContain("data-reader-psychiatrist-sheet");
    expect(readerSource).toContain("<TraumaSheet");
    expect(readerSource).toContain('ariaLabel="Psychiatrist"');
    expect(readerSource).toContain("data-reader-end-footer");
    expect(readerSource).toContain("readerSourceLinkClass");
    expect(readerSource).toContain("ScrollableUrlLink");
    expect(tailwindSource).toContain(".trauma-scroll-url-link");
    expect(tailwindSource).toContain(".trauma-scroll-url-shell");
    expect(tailwindSource).toContain(".trauma-reader-topbar");
    expect(tailwindSource).toContain(".trauma-reader-landmark-rail");
    expect(tailwindSource).toContain(".trauma-reader-psychiatrist-sheet");
    expect(tailwindSource).not.toContain(".trauma-reader-inspector");
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
      "animate-trauma-pop-bounce relative overflow-hidden rounded-2xl",
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

  it("defines :lang() typography rules for JA, CJK, RTL, Devanagari, and Thai reader content", () => {
    expect(tailwindSource).toContain(".trauma-reader-content:lang(ja)");
    expect(tailwindSource).toContain("line-break: strict");
    expect(tailwindSource).toContain("text-autospace: normal");
    expect(tailwindSource).toContain('font-feature-settings: "palt" 1');
    expect(tailwindSource).toContain("word-break: auto-phrase");
    expect(tailwindSource).toContain(".trauma-reader-content:lang(ko)");
    expect(tailwindSource).toContain("word-break: keep-all");
    expect(tailwindSource).toContain(".trauma-reader-content:lang(zh-Hans)");
    expect(tailwindSource).toContain(".trauma-reader-content:lang(zh-Hant)");
    expect(tailwindSource).toContain(".trauma-reader-content:lang(ar)");
    expect(tailwindSource).toContain("letter-spacing: 0 !important");
    expect(tailwindSource).toContain(".trauma-reader-content:lang(hi)");
    expect(tailwindSource).toContain(".trauma-reader-content:lang(th)");
  });
});
