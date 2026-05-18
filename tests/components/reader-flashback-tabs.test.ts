import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { ReaderFlashbackTabs } from "../../src/components/reader/MemoryReader";

const allFlashbacks = [
  {
    id: "flashback-current",
    memoryId: "memory-1",
    memoryTitle: "Current Memory",
    text: "current flashback",
    prefix: "current ",
    suffix: " text",
    startOffset: 0,
    endOffset: 17,
    createdAt: "2026-05-15T00:00:00.000Z",
  },
  {
    id: "flashback-other",
    memoryId: "memory-2",
    memoryTitle: "Other Memory",
    text: "other flashback",
    prefix: "other ",
    suffix: " text",
    startOffset: 0,
    endOffset: 15,
    createdAt: "2026-05-14T00:00:00.000Z",
  },
];

const currentFlashbacks = [
  {
    id: "flashback-current",
    text: "current flashback",
    prefix: "current ",
    suffix: " text",
    startOffset: 0,
    endOffset: 17,
    createdAt: "2026-05-15T00:00:00.000Z",
  },
];

describe("reader flashback tabs", () => {
  it("renders Current as the left tab and All as the second tab", () => {
    const html = renderTabs({ initialTab: "memory" });
    const currentIndex = html.indexOf(">Current<");
    const allIndex = html.indexOf(">All<");

    expect(currentIndex).toBeGreaterThan(-1);
    expect(allIndex).toBeGreaterThan(-1);
    expect(allIndex).toBeGreaterThan(currentIndex);
    expect(html).not.toContain("This memory");
    expect(html).not.toContain("All flashbacks");
  });

  it("uses the same segmented toggle button styling as the theme box", () => {
    const html = renderTabs({ initialTab: "memory" });

    expect(html).toContain("inline-flex min-h-9 items-center justify-center");
    expect(html).toContain("aria-pressed:ring-1");
    expect(html).toContain("aria-pressed:ring-inset");
    expect(html).toContain("aria-pressed:ring-trauma-border-strong");
  });

  it("uses the shared flashback shortcut row design for flashback lists", () => {
    const html = renderTabs({ initialTab: "all" });

    expect(html).toContain("grid w-full gap-1 rounded-2xl px-3 py-2 text-left");
    expect(html).toContain("hover:bg-trauma-bg-tint");
    expect(html).not.toContain("<blockquote");
    expect(html).toContain("trauma-flashback-context-before");
    expect(html).toContain("trauma-flashback-context-after");
    expect(html).toContain("font-bold text-trauma-text-primary");
  });

  it("defaults to Current when the active memory has flashbacks", () => {
    const html = renderTabs();

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("current flashback");
    expect(html).not.toContain("other flashback");
    expect(html).toContain('href="#flashback-current"');
  });

  it("defaults to Current when the active memory has no flashbacks", () => {
    const html = renderTabs({ currentFlashbacks: [] });

    expect(html).toContain("No flashbacks for this memory yet");
    expect(html).not.toContain("other flashback");
  });

  it("lists all flashback rows across memories when the all tab is active", () => {
    const html = renderTabs({ initialTab: "all" });

    expect(html).toContain("current flashback");
    expect(html).toContain("other flashback");
    expect(html).toContain('href="/memories/memory-1#flashback-current"');
    expect(html).toContain('href="/memories/memory-2#flashback-other"');
  });

  it("renders a concise current-memory empty state", () => {
    const html = renderTabs({
      currentFlashbacks: [],
      initialTab: "memory",
    });

    expect(html).toContain("No flashbacks for this memory yet");
  });
});

function renderTabs(input: {
  currentFlashbacks?: typeof currentFlashbacks;
  initialTab?: "all" | "memory";
} = {}) {
  return renderToString(() =>
    createComponent(ReaderFlashbackTabs, {
      allFlashbacks,
      currentFlashbacks: input.currentFlashbacks ?? currentFlashbacks,
      initialTab: input.initialTab,
      memoryId: "memory-1",
    }),
  );
}
