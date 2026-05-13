import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readerSource = readFileSync("src/components/reader/MemoryReader.tsx", "utf8");
const readerStyles = readFileSync("src/components/reader/reader-styles.ts", "utf8");
const readerRoute = readFileSync("src/routes/memories/[id].tsx", "utf8");
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
});
