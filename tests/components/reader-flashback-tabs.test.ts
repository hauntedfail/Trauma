import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";

const flashbackLoaderMocks = vi.hoisted(() => ({
  getFlashbackBrowsePage: vi.fn<
    (_input: { cursor: string | null }) => Promise<never>
  >(),
  revalidateFlashbackBrowsePage: vi.fn(),
  revalidateFlashbackBrowseRows: vi.fn(),
}));

vi.mock("../../src/components/flashbacks/flashbacks-loader", () => flashbackLoaderMocks);

const { ReaderFlashbackTabs } = await import("../../src/components/reader/MemoryReader");

const allFlashbacks = [
  {
    id: "flashback-current",
    memoryId: "memory-1",
    memoryTitle: "Current Memory",
    variantKind: "source" as const,
    langCode: null,
    translationOutputHash: null,
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
    variantKind: "translation" as const,
    langCode: "ja-JP" as const,
    translationOutputHash: "sha256:" + "a".repeat(64),
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
    variantKind: "source" as const,
    langCode: null,
    translationOutputHash: null,
    createdAt: "2026-05-15T00:00:00.000Z",
  },
];

describe("reader flashback tabs", () => {
  beforeEach(() => {
    flashbackLoaderMocks.getFlashbackBrowsePage.mockReset();
    flashbackLoaderMocks.getFlashbackBrowsePage.mockReturnValue(
      new Promise<never>(() => {}),
    );
    flashbackLoaderMocks.revalidateFlashbackBrowsePage.mockReset();
    flashbackLoaderMocks.revalidateFlashbackBrowseRows.mockReset();
  });

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

  it("does not request global flashbacks while the default Current tab is active", () => {
    const html = renderTabs({ omitAllFlashbacks: true });

    expect(html).toContain("current flashback");
    expect(html).not.toContain("Loading flashbacks...");
    expect(flashbackLoaderMocks.getFlashbackBrowsePage).not.toHaveBeenCalled();
  });

  it("defaults to Current when the active memory has no flashbacks", () => {
    const html = renderTabs({ currentFlashbacks: [] });

    expect(html).toContain("No flashbacks for this memory yet");
    expect(html).not.toContain("other flashback");
  });

  it("loads global flashbacks when All is the initial tab and keeps loading state visible", () => {
    const html = renderTabs({
      initialTab: "all",
      omitAllFlashbacks: true,
    });

    expect(flashbackLoaderMocks.getFlashbackBrowsePage).toHaveBeenCalledOnce();
    expect(flashbackLoaderMocks.getFlashbackBrowsePage).toHaveBeenCalledWith({
      cursor: null,
    });
    expect(html).toContain("Loading flashbacks...");
  });

  it("lists all flashback rows across memories when the all tab is active", () => {
    const html = renderTabs({ initialTab: "all" });

    expect(html).toContain("current flashback");
    expect(html).toContain("other flashback");
    expect(html).toContain('href="/memories/memory-1#flashback-current"');
    expect(html).toContain('href="/memories/ja-JP/memory-2#flashback-other"');
    expect(flashbackLoaderMocks.getFlashbackBrowsePage).not.toHaveBeenCalled();
  });

  it("bounds the All list body and exposes rail-local page controls", () => {
    const html = renderTabs({ initialTab: "all" });

    expect(html).toContain("max-h-[min(44vh,24rem)]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overscroll-contain");
    expect(html).toContain(">First<");
    expect(html).toContain(">Previous<");
    expect(html).toContain(">Next<");
  });

  it("uses shared memory anchor href builders for Flashback shortcuts", () => {
    const source = readFileSync("src/components/reader/MemoryReader.tsx", "utf8");

    expect(source).toContain("buildMemoryVariantAnchorHref");
    expect(source).toContain("buildSameMemoryAnchorHref");
  });

  it("keeps the global Flashback query out of the reader's initial render path", () => {
    const source = readFileSync("src/components/reader/MemoryReader.tsx", "utf8");
    const readyReaderSource = source.slice(
      source.indexOf("function ReadyMemoryReader"),
      source.indexOf("function ReaderRightRailContent"),
    );
    const tabsSource = source.slice(
      source.indexOf("export function ReaderFlashbackTabs"),
      source.indexOf("function getReaderSelectionKey"),
    );

    expect(readyReaderSource).not.toContain("getFlashbackBrowsePage");
    expect(readyReaderSource).not.toContain("createAsync(() => getFlashbackBrowsePage())");
    expect(tabsSource).toContain("shouldLoadAll");
    expect(tabsSource).toContain("getFlashbackBrowsePage");
    expect(tabsSource).toContain("cursorHistory");
  });

  it("renders a concise current-memory empty state", () => {
    const html = renderTabs({
      currentFlashbacks: [],
      initialTab: "memory",
    });

    expect(html).toContain("No flashbacks for this memory yet");
  });

  it("revalidates the current All cursor through an accessible retry action", () => {
    const source = readFileSync("src/components/reader/MemoryReader.tsx", "utf8");
    const tabsSource = source.slice(
      source.indexOf("export function ReaderFlashbackTabs"),
      source.indexOf("function getReaderSelectionKey"),
    );

    expect(tabsSource).toContain("CollectionPageRetry");
    expect(tabsSource).toContain("createCollectionPageRetryController");
    expect(tabsSource).toContain("isRetryingCurrentPage()");
    expect(tabsSource).toContain("revalidatePage: revalidateFlashbackBrowsePage");
    expect(tabsSource).toContain('subject="all flashbacks"');
  });
});

function renderTabs(input: {
  currentFlashbacks?: typeof currentFlashbacks;
  initialTab?: "all" | "memory";
  omitAllFlashbacks?: boolean;
} = {}) {
  return renderToString(() =>
    createComponent(
      ReaderFlashbackTabs,
      input.omitAllFlashbacks === true
        ? {
            currentFlashbacks: input.currentFlashbacks ?? currentFlashbacks,
            initialTab: input.initialTab,
            memoryId: "memory-1",
          }
        : {
            allFlashbacks,
            currentFlashbacks: input.currentFlashbacks ?? currentFlashbacks,
            initialTab: input.initialTab,
            memoryId: "memory-1",
          },
    ),
  );
}
