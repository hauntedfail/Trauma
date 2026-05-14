import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");
const tailwindCss = readFileSync("src/styles/tailwind.css", "utf8");
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
const rightRailContextPath = "src/components/shell/right-rail-context.tsx";
const rightRailContextSource = existsSync(rightRailContextPath)
  ? readFileSync(rightRailContextPath, "utf8")
  : "";

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

  it("supports route-specific right rail content before browse filters", () => {
    expect(rightRailContextSource).toContain("createContext");
    expect(appShellSource).toContain("RightRailContentContext.Provider");
    expect(appShellSource).toContain("rightRailContent()");

    const contextualContentIndex = appShellSource.indexOf("rightRailContent()");
    const browseFiltersIndex = appShellSource.indexOf("<FilterPanel");
    expect(contextualContentIndex).toBeGreaterThan(-1);
    expect(contextualContentIndex).toBeLessThan(browseFiltersIndex);
  });

  it("keeps right rail shortcut lists as bounded independent scroll regions", () => {
    expect(appShellSource).toContain("rightRailSurface");
    expect(appShellSource).toContain("rightRailStack");
    expect(appShellSource).toContain("rightRailScrollContent");
    expect(appShellSource).toContain("overflow-hidden");
    expect(appShellSource).toContain("max-h-[min(34vh,20rem)]");
    expect(appShellSource).toContain("overflow-y-auto");
    expect(appShellSource).toContain("overscroll-contain");
    expect(appShellSource).not.toContain(
      'h-screen overflow-y-auto bg-trauma-bg-base px-6 py-4 max-[1040px]:hidden',
    );
  });

  it("keeps the left rail scale close to the refined sample", () => {
    expect(appShellSource).toContain("px-2 py-1 pb-3");
    expect(appShellSource).toContain("grid-cols-[32px_minmax(0,1fr)]");
    expect(appShellSource).toContain("gap-[18px]");
    expect(appShellSource).toContain("text-[19px]");
    expect(appShellSource).toContain("min-h-[52px]");
  });

  it("keeps left rail tab labels tall enough for descenders", () => {
    expect(appShellSource).toContain("text-[19px] font-medium leading-[1.22]");
    expect(appShellSource).not.toContain("text-[19px] font-medium leading-none");
  });

  it("keeps the left rail vertical rhythm slightly open", () => {
    expect(appShellSource).toContain('class="flex flex-col gap-1.5"');
    expect(appShellSource).toContain('nav class="grid content-start gap-1"');
    expect(appShellSource).toContain("mx-1 my-3.5");
  });

  it("keeps selected theme options visible on normal night mode", () => {
    expect(appShellSource).toContain("themeToggleButton");
    expect(appShellSource).toContain("aria-pressed:bg-trauma-bg-elev");
    expect(appShellSource).toContain("aria-pressed:ring-1");
    expect(appShellSource).not.toContain("aria-pressed:bg-trauma-bg-surface");
  });

  it("opens theme controls from a left rail tab instead of keeping them expanded", () => {
    expect(appShellSource).toContain("ThemeNavButton");
    expect(appShellSource).toContain('aria-haspopup="dialog"');
    expect(appShellSource).toContain("aria-expanded={isThemeOpen()}");
    expect(appShellSource).toContain('role="dialog"');
    expect(appShellSource).toContain('aria-label="Theme settings"');
    expect(appShellSource).toContain("animate-trauma-pop-bounce");
    expect(appShellSource).not.toContain(
      '<section class="mt-auto grid gap-1.5',
    );
  });

  it("places the theme tab between backup and settings", () => {
    const backupIndex = appShellSource.indexOf("item={futureNavItems.backup}");
    const themeIndex = appShellSource.indexOf("<ThemeNavButton");
    const settingsIndex = appShellSource.indexOf("item={futureNavItems.settings}");

    expect(backupIndex).toBeGreaterThan(-1);
    expect(themeIndex).toBeGreaterThan(backupIndex);
    expect(settingsIndex).toBeGreaterThan(themeIndex);
  });

  it("uses paper-mode wax seal controls for add memory and view toggles", () => {
    expect(appShellSource).toContain("trauma-paper-wax-seal trauma-paper-wax-command");
    expect(memoryBrowseSource).toContain("trauma-paper-wax-seal trauma-paper-wax-toggle");
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-paper-wax-seal');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-paper-wax-seal::before');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-paper-wax-seal::after');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-paper-wax-seal[aria-pressed="true"]');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-paper-wax-seal:active');

    const waxStart = tailwindCss.indexOf(':root[data-theme^="paper"] .trauma-paper-wax-seal');
    const activeNavStart = tailwindCss.indexOf(
      ':root[data-theme^="paper"] .trauma-active-nav-item',
      waxStart,
    );

    expect(waxStart).toBeGreaterThan(-1);
    expect(activeNavStart).toBeGreaterThan(waxStart);

    const waxRules = tailwindCss.slice(waxStart, activeNavStart);

    expect(waxRules).toContain("inset: 3px;");
    expect(waxRules).toContain(
      "background: color-mix(in srgb, var(--accent-press) 52%, transparent);",
    );
    expect(waxRules).not.toContain("border:");
    expect(waxRules).toContain("animation: trauma-wax-press");
    expect(waxRules).toContain("opacity: 0.92;");
    expect(waxRules).toContain("inset: 6px 7px;");
    expect(waxRules).toContain("inset: 7px 10px;");
    expect(waxRules).not.toContain("clip-path");
    expect(waxRules).not.toContain("z-index: -1");
    expect(waxRules).not.toContain("inset: -");
    expect(waxRules).not.toContain("animation: trauma-wax-edge-spread");
    expect(waxRules).not.toContain("border: 1px solid");
    expect(waxRules).not.toContain("outline:");
    expect(waxRules).not.toContain("outline-offset:");
    expect(waxRules).not.toContain("radial-gradient");
    expect(waxRules).not.toContain("linear-gradient(145deg");
    expect(waxRules).not.toContain("text-shadow");
    expect(waxRules).not.toContain("box-shadow");
    expect(waxRules).not.toContain("height: 0.82rem");
    expect(waxRules).not.toContain("width: 1.85rem");
    expect(waxRules).not.toContain("background: color-mix(in srgb, var(--accent) 42%, transparent);");
    expect(appShellSource).not.toContain("shadow-trauma-1");
  });

  it("uses a handwritten animated underline for active nav links in paper themes", () => {
    expect(appShellSource).toContain("trauma-active-nav-item");
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-active-nav-item');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-active-nav-item::after');
    expect(tailwindCss).toContain("@keyframes trauma-handwrite-underline");
    expect(tailwindCss).toContain("animation: trauma-handwrite-underline");
    expect(tailwindCss).toContain("-webkit-mask-image: url(\"data:image/svg+xml;utf8,");
    expect(tailwindCss).toContain("clip-path: inset(0 100% 0 0)");
    expect(tailwindCss).toContain("background-color: transparent");
  });

  it("keeps the reader TOC overflow spotlight shadow neutral black", () => {
    const spotlightStart = tailwindCss.indexOf(".trauma-toc-scroll-spotlight");
    const nextRuleStart = tailwindCss.indexOf(
      ':root[data-theme^="paper"] .trauma-paper-wax-seal',
      spotlightStart,
    );

    expect(spotlightStart).toBeGreaterThan(-1);
    expect(nextRuleStart).toBeGreaterThan(spotlightStart);

    const spotlightRule = tailwindCss.slice(spotlightStart, nextRuleStart);

    expect(spotlightRule).toContain("rgb(0 0 0 /");
    expect(spotlightRule).not.toContain("var(--accent)");
  });
});
