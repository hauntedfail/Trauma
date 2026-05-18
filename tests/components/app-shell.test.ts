import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");
const tailwindCss = readFileSync("src/styles/tailwind.css", "utf8");
const memoryBrowseSource = readFileSync(
  "src/components/memories/MemoryBrowse.tsx",
  "utf8",
);
const addMemoryFormSource = readFileSync(
  "src/components/memories/AddMemoryForm.tsx",
  "utf8",
);
const flashbacksRouteSource = readFileSync(
  "src/routes/flashbacks/index.tsx",
  "utf8",
);
const readerStylesSource = readFileSync(
  "src/components/reader/reader-styles.ts",
  "utf8",
);
const waxSealButtonPath = "src/components/ui/WaxSealButton.tsx";
const waxSealButtonSource = existsSync(waxSealButtonPath)
  ? readFileSync(waxSealButtonPath, "utf8")
  : "";
const segmentedToggleButtonPath = "src/components/ui/SegmentedToggleButton.tsx";
const segmentedToggleButtonSource = existsSync(segmentedToggleButtonPath)
  ? readFileSync(segmentedToggleButtonPath, "utf8")
  : "";
const rightRailContextPath = "src/components/shell/right-rail-context.tsx";
const rightRailContextSource = existsSync(rightRailContextPath)
  ? readFileSync(rightRailContextPath, "utf8")
  : "";
const popupSource = readFileSync("src/components/ui/Popup.tsx", "utf8");

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

  it("guards localStorage reads and writes so blocked storage does not break hydration", () => {
    expect(appShellSource).toContain("function readLocalStorageItem");
    expect(appShellSource).toContain("function writeLocalStorageItem");
    expect(appShellSource).toContain("readLocalStorageItem(BRIGHTNESS_STORAGE_KEY)");
    expect(appShellSource).toContain(
      "writeLocalStorageItem(BRIGHTNESS_STORAGE_KEY, nextBrightness)",
    );
    expect(appShellSource).toContain("try {");
    expect(appShellSource).toContain("catch {");
  });

  it("does not add live links for routes that do not exist yet", () => {
    expect(appShellSource).not.toContain('href="/category"');
    expect(appShellSource).not.toContain('href="/tags"');
    expect(appShellSource).not.toContain('href="/backup"');
    expect(appShellSource).toContain('href: "/settings"');
  });

  it("opens right-rail Flashback shortcuts through shared memory anchor hrefs", () => {
    expect(appShellSource).toContain("buildMemoryAnchorHref");
    expect(appShellSource).not.toContain("buildFlashbackBrowseHref");
  });

  it("routes right-rail taxonomy clicks into the search query by human-readable name", () => {
    expect(appShellSource).toContain("toggleBrowseSearchFieldFilter");
    expect(appShellSource).toContain('field: "category"');
    expect(appShellSource).toContain('field: "tag"');
    expect(appShellSource).toContain("value: category.name");
    expect(appShellSource).toContain("value: tag.name");
    expect(appShellSource).not.toContain('toggleFilter("category", category.id)');
    expect(appShellSource).not.toContain('toggleFilter("tag", tag.id)');
  });

  it("uses filled icons and bold labels for active tabs without active background fills", () => {
    const activeNavStart = appShellSource.indexOf("const activeNavItem =");
    const activeNavEnd = appShellSource.indexOf("const disabledNavItem =", activeNavStart);
    const activeNavDeclaration = appShellSource.slice(activeNavStart, activeNavEnd);
    const phoneTabStart = appShellSource.indexOf("const phoneTabButton =");
    const phoneTabEnd = appShellSource.indexOf("const phonePopoverPanel =", phoneTabStart);
    const phoneTabDeclaration = appShellSource.slice(phoneTabStart, phoneTabEnd);

    expect(activeNavDeclaration).toContain("trauma-active-nav-item");
    expect(appShellSource).toContain('${isActive() ? "font-bold" : ""}');
    expect(activeNavDeclaration).not.toContain("bg-trauma-accent-soft");
    expect(activeNavDeclaration).not.toContain("text-trauma-accent-soft-ink");
    expect(activeNavDeclaration).not.toContain("hover:bg-trauma-accent-soft");
    expect(activeNavDeclaration).not.toContain("hover:text-trauma-accent-soft-ink");
    expect(phoneTabDeclaration).not.toContain("aria-pressed:bg-trauma-accent-soft");
    expect(phoneTabDeclaration).not.toContain("aria-pressed:text-trauma-accent-soft-ink");
    expect(appShellSource).toContain('[isActive() ? "filled" : "outline"]');
  });

  it("keeps paper active underlines on the desktop rail item geometry", () => {
    expect(tailwindCss).toContain(
      "container: trauma-left-rail / inline-size",
    );
    expect(tailwindCss).toContain(
      "@container trauma-left-rail (width > 16rem)",
    );
    expect(tailwindCss).toContain(
      ':root[data-theme^="paper"] .trauma-active-nav-item::after',
    );
    expect(tailwindCss).toContain("right: 18px;");
    expect(tailwindCss).toContain("bottom: 5px;");
    expect(tailwindCss).toContain("left: 62px;");
    expect(tailwindCss).not.toContain(
      ':root[data-theme^="paper"] .trauma-active-nav-item .trauma-active-nav-label::after',
    );
  });

  it("keeps desktop shell columns flush instead of centering panes inside gutters", () => {
    expect(appShellSource).toContain(
      "min-[1041px]:grid-cols-[275px_minmax(0,840px)_360px]",
    );
    expect(appShellSource).toContain("grid-cols-[275px_minmax(0,840px)_360px]");
    expect(appShellSource).toContain("justify-center");
    expect(appShellSource).toContain("border-r border-trauma-border");
  });

  it("keeps route panes full-width inside the shell column", () => {
    for (const source of [
      memoryBrowseSource,
      flashbacksRouteSource,
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
    expect(appShellSource).toContain("rounded-[20px] border border-trauma-border");
    expect(appShellSource).toContain("bg-trauma-bg-base");
  });

  it("supports route-specific right rail content before browse filters", () => {
    expect(rightRailContextSource).toContain("createContext");
    expect(appShellSource).toContain("RightRailContentContext.Provider");
    expect(appShellSource).toContain("rightRailContent()");
    expect(appShellSource).toContain("rightRailContent() === undefined");
    expect(appShellSource).toContain('!activePath().startsWith("/flashbacks")');

    const contextualContentIndex = appShellSource.indexOf("rightRailContent()");
    const browseFiltersIndex = appShellSource.indexOf("<RightRailFilters");
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
      'overflow-y-auto bg-trauma-bg-base px-6 py-4 max-[1040px]:hidden',
    );
  });

  it("keeps the left rail scale close to the refined sample", () => {
    expect(appShellSource).toContain("px-2 py-1 pb-3");
    expect(appShellSource).toContain("rounded-full px-2.5 text-[22px]");
    expect(appShellSource).toContain("grid-cols-[40px_minmax(0,1fr)]");
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
    expect(appShellSource).toContain("SegmentedToggleButton");
    expect(segmentedToggleButtonSource).toContain("aria-pressed:bg-trauma-bg-elev");
    expect(segmentedToggleButtonSource).toContain("aria-pressed:ring-1");
    expect(appShellSource).not.toContain("aria-pressed:bg-trauma-bg-surface");
    expect(appShellSource).not.toContain("max-[1040px]:size-10 max-[1040px]:px-0");
  });

  it("opens theme controls from a left rail tab instead of keeping them expanded", () => {
    expect(appShellSource).toContain("ThemeNavButton");
    expect(appShellSource).toContain("TraumaNavIcons.theme");
    expect(appShellSource).toContain("<Popup");
    expect(appShellSource).toContain('label="Theme settings"');
    expect(appShellSource).toContain('mode="dialog"');
    expect(appShellSource).toContain("trigger={({ open, triggerProps })");
    expect(appShellSource).toContain("aria-pressed={open}");
    expect(popupSource).toContain('aria-haspopup": mode()');
    expect(popupSource).toContain("role={mode()}");
    expect(popupSource).toContain("animate-trauma-pop-bounce");
    expect(appShellSource).not.toContain(
      '<section class="mt-auto grid gap-1.5',
    );
  });

  it("keeps rail popovers layered above route panes", () => {
    expect(appShellSource).toContain(
      '"trauma-shell-left-rail sticky top-0 z-40 h-[100svh] overflow-visible bg-trauma-bg-base max-[720px]:hidden"',
    );
    expect(popupSource).toContain("z-[70]");
    expect(popupSource).toContain("top-full mt-1");
    expect(appShellSource).not.toContain(
      '"sticky top-0 overflow-y-auto bg-trauma-bg-base max-[720px]:hidden"',
    );
  });

  it("labels surface options by brightness while preserving stored values", () => {
    expect(appShellSource).toContain("getNormalSurfaceLabel");
    expect(appShellSource).toContain("themeNameFromPreference");
    expect(appShellSource).toContain(
      'themeNameFromPreference({ brightness, surface: "normal" }) === "midnight"',
    );
    expect(appShellSource).toContain("const normalSurfaceLabel = createMemo");
    expect(appShellSource).toContain("<span>{normalSurfaceLabel()}</span>");
    expect(appShellSource).toContain("getPaperSurfaceLabel");
    expect(appShellSource).toContain(
      'themeNameFromPreference({ brightness, surface: "paper" }) === "hermes"',
    );
    expect(appShellSource).toContain("const paperSurfaceLabel = createMemo");
    expect(appShellSource).toContain("const paperSurfaceIcon = createMemo");
    expect(appShellSource).toContain('props.brightness === "night" ? <HermesIcon /> : <PaperIcon />');
    expect(appShellSource).toContain("<span>{paperSurfaceLabel()}</span>");
    expect(appShellSource).toContain("{paperSurfaceIcon()}");
    expect(appShellSource).toContain('onClick={() => props.onSurface("normal")}');
    expect(appShellSource).not.toContain("<span>Normal</span>");
  });

  it("places the theme tab between backup and settings", () => {
    const navigationStart = appShellSource.indexOf("aria-label=\"Primary sections\"");
    const backupIndex = appShellSource.indexOf(
      "item={futureNavItems.backup}",
      navigationStart,
    );
    const themeIndex = appShellSource.indexOf("<ThemeNavButton", backupIndex);
    const settingsIndex = appShellSource.indexOf(
      "item={settingsNavItem}",
      themeIndex,
    );

    expect(backupIndex).toBeGreaterThan(-1);
    expect(themeIndex).toBeGreaterThan(backupIndex);
    expect(settingsIndex).toBeGreaterThan(themeIndex);
  });

  it("keeps add-memory URL label colour theme-tokenized", () => {
    expect(addMemoryFormSource).toContain("text-trauma-text-muted");
    expect(addMemoryFormSource).not.toContain("text-[#4e5a48]");
    expect(addMemoryFormSource).not.toContain("color:");
  });

  it("opens add memory from the left rail as a popover instead of a global drawer", () => {
    expect(appShellSource).toContain("AddMemoryComposerButton");
    expect(appShellSource).toContain('popoverId="rail-add-memory-composer"');
    expect(appShellSource).toContain('popoverId="phone-add-memory-composer"');
    expect(appShellSource).toContain('label="Add memory"');
    expect(appShellSource).toContain('mode="dialog"');
    expect(appShellSource).toContain("trigger={({");
    expect(popupSource).toContain('"aria-controls": open() ? props.id : undefined');
    expect(popupSource).toContain('"aria-expanded": open()');
    expect(popupSource).toContain('"aria-haspopup": mode()');
    expect(popupSource).toContain("role={mode()}");
    expect(appShellSource).not.toContain('<Drawer ariaLabel="Add memory"');
    expect(appShellSource).not.toContain("setIsComposerOpen(true)");
    expect(appShellSource).toContain("aria-pressed={open}");
    expect(appShellSource).toContain("<WaxSealButton");
    expect(appShellSource).toContain("<WaxSealLabel");
  });

  it("uses paper-mode wax seal controls for add memory and view toggles", () => {
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-paper-wax-seal');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-paper-wax-seal::before');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-paper-wax-seal::after');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-paper-wax-seal[aria-pressed="true"]');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-paper-wax-seal:active');
    expect(waxSealButtonSource).toContain("export function WaxSealButton");
    expect(waxSealButtonSource).toContain("export function WaxSealLabel");
    expect(waxSealButtonSource).toContain("trauma-paper-wax-seal");
    expect(waxSealButtonSource).toContain("trauma-paper-wax-command");
    expect(waxSealButtonSource).toContain("trauma-paper-wax-toggle");
    expect(waxSealButtonSource).toContain("trauma-paper-wax-label");
    expect(appShellSource).toContain('variant="command"');
    expect(appShellSource).toContain("composerSubmitButton");
    expect(appShellSource).toContain("rounded-full border border-trauma-border-strong");
    expect(appShellSource).toContain("<WaxSealLabel");
    expect(appShellSource).toContain("max-[1040px]:sr-only");
    expect(memoryBrowseSource).toContain("<WaxSealButton");
    expect(memoryBrowseSource).toContain("<WaxSealLabel>List</WaxSealLabel>");
    expect(memoryBrowseSource).toContain("<WaxSealLabel>Grid</WaxSealLabel>");
    expect(addMemoryFormSource).toContain("<WaxSealButton");
    expect(addMemoryFormSource).toContain("<WaxSealLabel>");
    expect(appShellSource).not.toContain("trauma-paper-wax-seal trauma-paper-wax-command");
    expect(memoryBrowseSource).not.toContain("trauma-paper-wax-seal trauma-paper-wax-toggle");

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
    expect(waxRules).toContain(
      ':root[data-theme^="paper"] .trauma-paper-wax-seal > *',
    );
    expect(waxRules).toContain("position: relative;");
    expect(waxRules).toContain("z-index: 1;");
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
    expect(tailwindCss).toContain(
      ':root[data-theme^="paper"] .trauma-active-nav-item::after',
    );
    expect(tailwindCss).toContain("@keyframes trauma-handwrite-underline");
    expect(tailwindCss).toContain("animation: trauma-handwrite-underline");
    expect(tailwindCss).toContain("-webkit-mask-image: url(\"data:image/svg+xml;utf8,");
    expect(tailwindCss).toContain("stroke-linecap='round'");
    expect(tailwindCss).toContain("stroke-width='5'");
    expect(tailwindCss).toContain("clip-path: inset(0 100% 0 0)");
    expect(tailwindCss).toContain("background-color: transparent");
  });

  it("keeps the reader TOC overflow fades as subtle neutral blur overlays", () => {
    const fadeStart = tailwindCss.indexOf(".trauma-toc-scroll-fade");
    const nextRuleStart = tailwindCss.indexOf(
      ':root[data-theme^="paper"] .trauma-paper-wax-seal',
      fadeStart,
    );

    expect(fadeStart).toBeGreaterThan(-1);
    expect(nextRuleStart).toBeGreaterThan(fadeStart);

    const fadeRule = tailwindCss.slice(fadeStart, nextRuleStart);

    expect(fadeRule).toContain("backdrop-filter: blur(");
    expect(fadeRule).toContain("rgb(0 0 0 /");
    expect(fadeRule).not.toContain("box-shadow");
    expect(fadeRule).not.toContain("radial-gradient");
    expect(fadeRule).not.toContain("var(--accent)");
  });

  it("keeps paper-mode shell panes transparent over the global material background", () => {
    expect(appShellSource).toContain("trauma-shell-frame");
    expect(appShellSource).toContain("trauma-shell-left-rail");
    expect(appShellSource).toContain("trauma-shell-main");
    expect(appShellSource).toContain("trauma-shell-right-rail");
    expect(tailwindCss).toContain(".trauma-shell-left-rail > *");
    expect(tailwindCss).toContain(
      ':root[data-theme^="paper"] body::before',
    );
    expect(tailwindCss).toContain(
      ':root[data-theme^="paper"] body::after',
    );
    expect(tailwindCss).toContain(
      ':root[data-theme="paper-black-dark"] body::after',
    );
    expect(tailwindCss).toContain(
      ':root[data-theme^="paper"] .trauma-shell-frame',
    );
    expect(tailwindCss).toContain(":root[data-theme^=\"paper\"] .trauma-shell-main");
    expect(tailwindCss).toContain(":root[data-theme^=\"paper\"] .trauma-shell-right-rail");
    expect(tailwindCss).toContain("background-color: transparent");
    expect(tailwindCss).toContain("background-image: none");
    expect(tailwindCss).not.toContain("border-right-color: transparent");
    expect(tailwindCss).not.toContain("border-right-width: 0");
    expect(tailwindCss).not.toContain(".trauma-shell-left-rail::before");
    expect(tailwindCss).not.toContain(".trauma-shell-left-rail::after");
    expect(tailwindCss).toContain("var(--leather-grain-overlay)");
  });
});
