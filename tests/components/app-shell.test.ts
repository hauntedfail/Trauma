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
    expect(appShellSource).toContain("grid-cols-[248px_minmax(0,840px)_360px]");
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
    expect(appShellSource).toContain('aria-label="Search archive"');
    expect(appShellSource).toContain("rounded-[32px] border border-trauma-border");
    expect(appShellSource).toContain("bg-trauma-bg-base");
  });
});
