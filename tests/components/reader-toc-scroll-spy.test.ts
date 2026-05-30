import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { emptyActiveTocRange } from "../../src/components/reader/toc-reading-range";
import {
  isSameActiveTocRange,
  readingLineOffset,
  readReaderHeadingPositions,
} from "../../src/components/reader/toc-scroll-spy";

const readerSource = readFileSync(
  "src/components/reader/MemoryReader.tsx",
  "utf8",
);
const tailwindSource = readFileSync("src/styles/tailwind.css", "utf8");

describe("readingLineOffset", () => {
  it("anchors the reading line one third down the viewport", () => {
    expect(readingLineOffset(900)).toBe(300);
  });
});

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
        { activeId: "a", chapterId: "a", rangeIds: ["a", "b"] },
        { activeId: "a", chapterId: "a", rangeIds: ["a", "b"] },
      ),
    ).toBe(true);
  });

  it("detects differences in active id or range membership", () => {
    expect(
      isSameActiveTocRange(emptyActiveTocRange, {
        activeId: "a",
        chapterId: "a",
        rangeIds: ["a"],
      }),
    ).toBe(false);
    expect(
      isSameActiveTocRange(
        { activeId: "a", chapterId: "a", rangeIds: ["a", "b"] },
        { activeId: "a", chapterId: "a", rangeIds: ["a", "c"] },
      ),
    ).toBe(false);
  });
});

describe("reader TOC reading-range visualization wiring", () => {
  it("feeds the active range into the TOC and marks the reading position", () => {
    expect(readerSource).toContain("activeTocRange={props.activeTocRange}");
    expect(readerSource).toContain('aria-current={isReadingPosition() ? "location" : undefined}');
    expect(readerSource).toContain("trauma-toc-reading-range");
    expect(readerSource).toContain("trauma-toc-reading-position");
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

  it("defines the reading-range surface treatment with design tokens", () => {
    expect(tailwindSource).toContain(".trauma-toc-reading-range");
    expect(tailwindSource).toContain(".trauma-toc-reading-position");
    expect(tailwindSource).toContain("prefers-reduced-motion: reduce");
    expect(tailwindSource).not.toMatch(/trauma-toc-reading-range[\s\S]*?#[0-9a-fA-F]{3,6}/);
  });
});
