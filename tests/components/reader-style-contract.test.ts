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
    expect(combinedSource).not.toMatch(/text-slate|border-slate|bg-slate|text-blue|bg-white|yellow-/);
  });

  it("keeps safe source-link rendering and read-only highlight toggles", () => {
    expect(readerSource).toContain("toSafeReaderSourceHref");
    expect(readerSource).toContain("data-reader-content");
    expect(readerSource).toContain("toggleReaderSelection");
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

  it("defines a reduced-motion-safe pop bounce animation for reader TOC entry", () => {
    expect(tailwindSource).toContain("@keyframes trauma-pop-bounce");
    expect(tailwindSource).toContain(".animate-trauma-pop-bounce");
    expect(tailwindSource).toContain("prefers-reduced-motion: reduce");
  });
});
