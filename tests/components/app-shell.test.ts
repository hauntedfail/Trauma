import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");
const memoryBrowseSource = readFileSync(
  "src/components/memories/MemoryBrowse.tsx",
  "utf8",
);
const highlightsRouteSource = readFileSync(
  "src/routes/highlights/index.tsx",
  "utf8",
);
const readerStylesSource = readFileSync(
  "src/components/reader/reader-styles.ts",
  "utf8",
);

describe("refined app shell contract", () => {
  it("uses the refined brand mark and icon system", () => {
    expect(appShellSource).toContain("TraumaMark");
    expect(appShellSource).toContain("TraumaNavIcons");
  });

  it("owns local theme controls without server persistence", () => {
    expect(appShellSource).toContain("themeFromPreference");
    expect(appShellSource).toContain("data-theme");
    expect(appShellSource).toContain("localStorage");
    expect(appShellSource).not.toContain("trauma.config.json");
  });

  it("does not add live links for routes that do not exist yet", () => {
    expect(appShellSource).not.toContain('href="/category"');
    expect(appShellSource).not.toContain('href="/tags"');
    expect(appShellSource).not.toContain('href="/backup"');
    expect(appShellSource).not.toContain('href="/settings"');
  });

  it("keeps desktop shell columns flush instead of centering panes inside gutters", () => {
    expect(appShellSource).toContain("grid-cols-[275px_minmax(0,840px)_360px]");
    expect(appShellSource).toContain("justify-center");
    expect(appShellSource).toContain("border-r border-trauma-border");
  });

  it("keeps route panes full-width inside the shell column", () => {
    for (const source of [
      memoryBrowseSource,
      highlightsRouteSource,
      readerStylesSource,
    ]) {
      expect(source).not.toContain("mx-auto");
      expect(source).not.toContain("w-[min(100%,840px)]");
      expect(source).not.toContain("max-w-[920px]");
    }
  });

  it("models the right rail as independent island sections", () => {
    expect(appShellSource).toContain("RightPanelSection");
    expect(appShellSource).not.toContain('aria-label="Search archive"');
    expect(appShellSource).toContain("rounded-[32px] border border-trauma-border");
    expect(appShellSource).toContain("bg-trauma-bg-base");
  });

  it("keeps the left rail scale close to the refined sample", () => {
    expect(appShellSource).toContain("px-2 py-1 pb-3");
    expect(appShellSource).toContain("grid-cols-[32px_minmax(0,1fr)]");
    expect(appShellSource).toContain("gap-[18px]");
    expect(appShellSource).toContain("text-[19px]");
    expect(appShellSource).toContain("min-h-[52px]");
  });

  it("keeps selected theme options visible on normal night mode", () => {
    expect(appShellSource).toContain("themeToggleButton");
    expect(appShellSource).toContain("aria-pressed:bg-trauma-bg-elev");
    expect(appShellSource).toContain("aria-pressed:ring-1");
    expect(appShellSource).not.toContain("aria-pressed:bg-trauma-bg-surface");
  });
});
