import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { ReaderHighlightTabs } from "../../src/components/reader/MemoryReader";

const allHighlights = [
  {
    id: "highlight-current",
    memoryId: "memory-1",
    memoryTitle: "Current Memory",
    text: "current highlight",
    prefix: "current ",
    suffix: " text",
    startOffset: 0,
    endOffset: 17,
    createdAt: "2026-05-15T00:00:00.000Z",
  },
  {
    id: "highlight-other",
    memoryId: "memory-2",
    memoryTitle: "Other Memory",
    text: "other highlight",
    prefix: "other ",
    suffix: " text",
    startOffset: 0,
    endOffset: 15,
    createdAt: "2026-05-14T00:00:00.000Z",
  },
];

const currentHighlights = [
  {
    id: "highlight-current",
    text: "current highlight",
    prefix: "current ",
    suffix: " text",
    startOffset: 0,
    endOffset: 17,
    createdAt: "2026-05-15T00:00:00.000Z",
  },
];

describe("reader highlight tabs", () => {
  it("renders All highlights as the left tab and This memory as the second tab", () => {
    const html = renderTabs({ initialTab: "memory" });
    const allIndex = html.indexOf("All highlights");
    const memoryIndex = html.indexOf("This memory");

    expect(allIndex).toBeGreaterThan(-1);
    expect(memoryIndex).toBeGreaterThan(allIndex);
  });

  it("defaults to This memory when the active memory has highlights", () => {
    const html = renderTabs();

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("current highlight");
    expect(html).not.toContain("other highlight");
    expect(html).toContain('href="#highlight-current"');
  });

  it("defaults to All highlights when the active memory has no highlights", () => {
    const html = renderTabs({ currentHighlights: [] });

    expect(html).toContain("current highlight");
    expect(html).toContain("other highlight");
    expect(html).toContain('href="/memories/memory-2#highlight-other"');
  });

  it("lists all highlight rows across memories when the all tab is active", () => {
    const html = renderTabs({ initialTab: "all" });

    expect(html).toContain("current highlight");
    expect(html).toContain("other highlight");
    expect(html).toContain('href="/memories/memory-1#highlight-current"');
    expect(html).toContain('href="/memories/memory-2#highlight-other"');
  });

  it("renders a concise current-memory empty state", () => {
    const html = renderTabs({
      currentHighlights: [],
      initialTab: "memory",
    });

    expect(html).toContain("No highlights for this memory yet");
  });
});

function renderTabs(input: {
  currentHighlights?: typeof currentHighlights;
  initialTab?: "all" | "memory";
} = {}) {
  return renderToString(() =>
    createComponent(ReaderHighlightTabs, {
      allHighlights,
      currentHighlights: input.currentHighlights ?? currentHighlights,
      initialTab: input.initialTab,
      memoryId: "memory-1",
    }),
  );
}
