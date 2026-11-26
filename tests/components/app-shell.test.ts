import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");
const commandPaletteSource = readFileSync(
  "src/components/shell/CommandPalette.tsx",
  "utf8",
);
const dialogSource = readFileSync("src/components/ui/Dialog.tsx", "utf8");
const tailwindCss = readFileSync("src/styles/tailwind.css", "utf8");
const rightRailContextPath = "src/components/shell/right-rail-context.tsx";
const popupSource = readFileSync("src/components/ui/Popup.tsx", "utf8");

describe("focus-first app shell contract", () => {
  it("uses the brand mark and focus-first nav icon system", () => {
    expect(appShellSource).toContain("TraumaMark");
    expect(appShellSource).toContain("TraumaNavIcons");
    expect(appShellSource).toContain('icon: "today"');
    expect(appShellSource).toContain('icon: "shelf"');
    expect(appShellSource).toContain('icon: "library"');
    expect(appShellSource).toContain("TraumaNavIcons.more");
  });

  it("owns local theme controls without server persistence", () => {
    expect(appShellSource).toContain("themeFromPreference");
    expect(appShellSource).toContain("data-theme");
    expect(appShellSource).toContain("localStorage");
    expect(appShellSource).not.toContain("trauma.config.json");
  });

  it("renders a 56px icon-only left rail and centered canvas with no right rail", () => {
    expect(appShellSource).toContain(
      "min-[721px]:grid-cols-[56px_minmax(0,1fr)]",
    );
    expect(appShellSource).toContain("w-[56px]");
    expect(appShellSource).toContain("mx-auto w-full max-w-[920px]");
    expect(appShellSource).not.toContain("275px");
    expect(appShellSource).not.toContain("360px");
    expect(appShellSource).not.toContain("trauma-shell-right-rail");
    expect(appShellSource).not.toContain('aria-label="Browse filters"');
  });

  it("removes the obsolete right-rail-context compatibility shim", () => {
    expect(existsSync(rightRailContextPath)).toBe(false);
    expect(appShellSource).not.toContain("right-rail-context");
    expect(appShellSource).not.toContain("RightRailContentContext");
  });

  it("keeps URL capture in the command palette instead of a separate composer", () => {
    expect(appShellSource).not.toContain("AddMemoryComposerButton");
    expect(appShellSource).not.toContain("rail-add-memory-composer");
    expect(appShellSource).not.toContain("<WaxSealButton");
    expect(appShellSource).not.toContain("bg-trauma-accent");
    expect(appShellSource).not.toContain("PlusIcon");
    expect(commandPaletteSource).toContain("Capture URL");
  });

  it("uses filled icons for active routes without active background fills or unread pips", () => {
    const activeNavStart = appShellSource.indexOf("const activeNavItem =");
    const activeNavEnd = appShellSource.indexOf(
      "const railPopoverRoot =",
      activeNavStart,
    );
    const activeNavDeclaration = appShellSource.slice(
      activeNavStart,
      activeNavEnd,
    );

    expect(activeNavDeclaration).toContain("trauma-active-nav-item");
    expect(activeNavDeclaration).not.toContain("bg-trauma-accent-soft");
    expect(activeNavDeclaration).not.toContain("text-trauma-accent-soft-ink");
    expect(appShellSource).toContain('[isActive() ? "filled" : "outline"]');
    expect(appShellSource).not.toContain('aria-label="unread"');
  });

  it("places the paper-theme handwritten active underline under the left-rail icon", () => {
    expect(appShellSource).toContain("trauma-active-nav-item");
    expect(tailwindCss).toContain(
      ':root[data-theme^="paper"] .trauma-shell-left-rail .trauma-active-nav-item::after',
    );
    expect(tailwindCss).not.toContain(
      "@container trauma-left-rail (width > 16rem)",
    );
    expect(tailwindCss).toContain("@keyframes trauma-handwrite-underline");
    expect(tailwindCss).toContain("animation: trauma-handwrite-underline");
    expect(tailwindCss).toContain(
      '-webkit-mask-image: url("data:image/svg+xml;utf8,',
    );
    expect(tailwindCss).toContain("stroke-linecap='round'");
    expect(tailwindCss).toContain("stroke-width='5'");
    expect(tailwindCss).toContain("clip-path: inset(0 100% 0 0)");
    expect(tailwindCss).toContain("background-color: transparent");
  });

  it("auto-hides the left rail on reader routes and respects prefers-reduced-motion", () => {
    expect(appShellSource).toContain("function isMemoryReaderPath");
    expect(appShellSource).toContain("data-rail-hidden=");
    expect(appShellSource).toContain("onFocusIn={() => setReaderRailHidden(false)}");
    expect(appShellSource).toContain("pointermove");
    expect(appShellSource).toContain('event.key === "Escape"');
    expect(tailwindCss).toContain('.trauma-shell-left-rail[data-rail-hidden="true"]');
    expect(tailwindCss).toContain("transform: translateX(-100%)");
    expect(tailwindCss).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("renders exactly 4 phone bottom tabs (Today, Shelf, Library, More) with no disabled tabs", () => {
    expect(appShellSource).toContain('aria-label="Primary tabs"');
    expect(appShellSource).toContain("grid-cols-4");
    expect(appShellSource).toContain('label: "Today"');
    expect(appShellSource).toContain('label: "Shelf"');
    expect(appShellSource).toContain('label: "Library"');
    expect(appShellSource).toContain("More");
    expect(appShellSource).toContain('id="phone-more-sheet"');
    expect(appShellSource).not.toContain('label: "Categories"');
    expect(appShellSource).not.toContain('label: "Tags"');
    expect(appShellSource).not.toContain('label: "Backup"');
    expect(appShellSource).not.toContain("PhoneDisabledTab");
    expect(appShellSource).not.toContain("FutureNavButton");
  });

  it("preserves BackupFailsafeBanner top precedence inside main", () => {
    const mainStart = appShellSource.indexOf("<main");
    const bannerIndex = appShellSource.indexOf("<BackupFailsafeBanner", mainStart);
    const childrenIndex = appShellSource.indexOf("{props.children}", mainStart);

    expect(mainStart).toBeGreaterThan(-1);
    expect(bannerIndex).toBeGreaterThan(mainStart);
    expect(bannerIndex).toBeLessThan(childrenIndex);
  });

  it("mounts the global CommandPalette with Cmd/Ctrl+K and focus restoration", () => {
    expect(appShellSource).toContain("isCommandPaletteShortcut");
    expect(appShellSource).toContain("<CommandPalette");
    expect(appShellSource).toContain("previousFocusedElement");
    expect(commandPaletteSource).toContain("<TraumaDialog");
    expect(dialogSource).toContain("@kobalte/core/dialog");
  });

  it("exposes and persists all four reading font presets and uses Kobalte Popover placement", () => {
    expect(appShellSource).toContain("READER_FONT_STORAGE_KEY");
    expect(appShellSource).toContain("data-reader-font");
    expect(appShellSource).toContain('aria-label="Reading font"');
    for (const label of ["Sans", "Serif", "Focus", "Mono"]) {
      expect(appShellSource).toContain(`<span>${label}</span>`);
    }
    expect(appShellSource).toContain('placement="right-end"');
    expect(appShellSource).not.toContain("left-full bottom-0 top-auto");
  });

  it("keeps the capture URL label colour theme-tokenized and rail popovers on Popup", () => {
    expect(commandPaletteSource).toContain("text-trauma-text-muted");
    expect(commandPaletteSource).not.toContain("text-[#4e5a48]");
    expect(commandPaletteSource).toContain("props.addMemorySubmission.url()");
    expect(commandPaletteSource).toContain("props.addMemorySubmission.isSubmitting()");
    expect(popupSource).toContain('"aria-controls": open() ? props.id : undefined');
    expect(popupSource).toContain('"aria-expanded": open()');
    expect(popupSource).toContain('"aria-haspopup": mode()');
    expect(popupSource).toContain("role={mode()}");
  });

  it("keeps paper-mode shell panes transparent over the global material background", () => {
    expect(appShellSource).toContain("trauma-shell-frame");
    expect(appShellSource).toContain("trauma-shell-left-rail");
    expect(appShellSource).toContain("trauma-shell-main");
    expect(tailwindCss).toContain(".trauma-shell-left-rail > *");
    expect(tailwindCss).toContain(':root[data-theme^="paper"] body::before');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] body::after');
    expect(tailwindCss).toContain(
      ':root[data-theme="paper-black-dark"] body::after',
    );
    expect(tailwindCss).toContain(
      ':root[data-theme^="paper"] .trauma-shell-frame',
    );
    expect(tailwindCss).toContain(
      ':root[data-theme^="paper"] .trauma-shell-main',
    );
    expect(tailwindCss).not.toContain(".trauma-shell-right-rail");
    expect(tailwindCss).toContain("var(--leather-grain-overlay)");
  });
});
