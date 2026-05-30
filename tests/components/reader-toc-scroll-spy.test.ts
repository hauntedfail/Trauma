import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { emptyActiveTocRange } from "../../src/components/reader/toc-reading-range";
import {
  isSameActiveTocRange,
  readReaderHeadingPositions,
} from "../../src/components/reader/toc-scroll-spy";

const readerSource = readFileSync(
  "src/components/reader/MemoryReader.tsx",
  "utf8",
);
const tailwindSource = readFileSync("src/styles/tailwind.css", "utf8");

describe("readReaderHeadingPositions", () => {
  it("returns an empty list when the root is undefined", () => {
    expect(readReaderHeadingPositions(undefined)).toEqual([]);
  });

  it("maps section-anchor elements to id and measured top", () => {
    const makeElement = (anchor: string | null): Element =>
      ({
        getAttribute: (name: string) =>
          name === "data-reader-section-anchor" ? anchor : null,
      }) as unknown as Element;
    const tops = new Map<Element, number>();
    const intro = makeElement("intro");
    const empty = makeElement("");
    const details = makeElement("details");
    tops.set(intro, 10);
    tops.set(details, 220);
    const root = {
      querySelectorAll: () => [intro, empty, details],
    } as unknown as ParentNode;

    const positions = readReaderHeadingPositions(
      root,
      (element) => tops.get(element) ?? -1,
    );

    expect(positions).toEqual([
      { id: "intro", top: 10 },
      { id: "details", top: 220 },
    ]);
  });
});

describe("isSameActiveTocRange", () => {
  it("treats structurally equal ranges as equal", () => {
    expect(
      isSameActiveTocRange(
        { leadId: "a", rangeIds: ["a", "b"] },
        { leadId: "a", rangeIds: ["a", "b"] },
      ),
    ).toBe(true);
  });

  it("detects differences in lead id or range membership", () => {
    expect(
      isSameActiveTocRange(emptyActiveTocRange, {
        leadId: "a",
        rangeIds: ["a"],
      }),
    ).toBe(false);
    expect(
      isSameActiveTocRange(
        { leadId: "a", rangeIds: ["a", "b"] },
        { leadId: "a", rangeIds: ["a", "c"] },
      ),
    ).toBe(false);
    expect(
      isSameActiveTocRange(
        { leadId: "a", rangeIds: ["a", "b"] },
        { leadId: "b", rangeIds: ["a", "b"] },
      ),
    ).toBe(false);
  });
});

describe("reader TOC reading-range visualization wiring", () => {
  it("feeds the active range into the TOC and marks the lead reading position", () => {
    expect(readerSource).toContain("activeTocRange={props.activeTocRange}");
    expect(readerSource).toContain('aria-current={isReadingLead() ? "location" : undefined}');
    expect(readerSource).toContain("trauma-toc-reading-range");
  });

  it("does not recolor the spied section text", () => {
    expect(readerSource).not.toContain("trauma-toc-reading-position");
    expect(tailwindSource).not.toContain("trauma-toc-reading-position");
  });

  it("reads the active range as an accessor so scrolling does not remount the right rail", () => {
    // The right-rail registration effect must not depend on the scroll-driven
    // active range; it is passed down as an accessor and read reactively inside
    // the mounted TOC rows instead.
    expect(readerSource).toContain("activeTocRange={activeTocRange}");
    expect(readerSource).not.toContain("activeTocRange={activeTocRange()}");
    expect(readerSource).toContain(
      "activeTocRange: Accessor<ActiveTocRange>",
    );
  });

  it("defines a subtle translucent reading-range surface with design tokens", () => {
    expect(tailwindSource).toContain(".trauma-toc-reading-range");
    // Subtle, transparent contrast lift rather than an accent fill.
    expect(tailwindSource).toMatch(
      /\.trauma-toc-reading-range \{[\s\S]*?background-color: color-mix\(in srgb, var\(--fg-1\) \d+% *, *transparent\)/,
    );
    expect(tailwindSource).not.toMatch(/trauma-toc-reading-range[\s\S]*?#[0-9a-fA-F]{3,6}/);
  });

  it("adds an elastic droplet animation gated by reduced motion", () => {
    expect(tailwindSource).toContain("@keyframes trauma-toc-droplet");
    expect(tailwindSource).toMatch(
      /\.trauma-toc-reading-range \{[\s\S]*?animation: trauma-toc-droplet/,
    );
    expect(tailwindSource).toContain("prefers-reduced-motion: reduce");
    expect(tailwindSource).toMatch(
      /prefers-reduced-motion: reduce\)[\s\S]*?\.trauma-toc-reading-range \{[\s\S]*?animation: none/,
    );
  });
});
