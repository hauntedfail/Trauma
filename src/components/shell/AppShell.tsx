import { A, createAsync, useLocation } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";

import { AddMemoryForm } from "../memories/AddMemoryForm";
import {
  createAddMemorySubmissionController,
  type AddMemorySubmissionController,
} from "../memories/add-memory-controller";
import { BackupFailsafeBanner } from "../backup/BackupFailsafeBanner";
import {
  getBackupFailsafeAlert,
  revalidateBackupFailsafeAlert,
} from "../backup/backup-failsafe-loader";
import { TraumaMark } from "../brand/TraumaMark";
import {
  HermesIcon,
  MoonIcon,
  PageIcon,
  PaperIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
  TraumaNavIcons,
} from "../icons";
import { revalidateBrowseMemoryWorkspace } from "../memories/browse-loader";
import { parseBrowseQuery, resolveBrowseLane } from "../memories/browse-data";
import {
  DEFAULT_BRIGHTNESS_MODE,
  DEFAULT_SURFACE_MODE,
  themeFromPreference,
  themeNameFromPreference,
  type BrightnessMode,
  type SurfaceMode,
} from "./theme";
import { CommandPalette } from "./CommandPalette";
import {
  extractFocusedMemoryId,
  isCommandPaletteShortcut,
} from "./command-palette-model";
import { SegmentedToggleButton } from "../ui/SegmentedToggleButton";
import { Popup } from "../ui/Popup";

interface RouteNavItem {
  href: string;
  icon: keyof typeof TraumaNavIcons;
  label: string;
  lane?: "today" | "shelf" | "library";
}

interface AppShellProps {
  children: JSX.Element;
}

const surfaceInput =
  "min-h-[42px] min-w-0 rounded-lg border border-trauma-border-strong bg-trauma-bg-surface px-3 text-trauma-text-primary placeholder:text-trauma-text-placeholder";
const sideSurface =
  "trauma-shell-left-rail sticky top-0 z-40 h-[100svh] w-[56px] overflow-visible border-r border-trauma-border bg-trauma-bg-base px-1.5 py-2.5 max-[720px]:hidden";
const composerSubmitButton =
  "inline-flex min-h-[38px] items-center justify-center rounded-full border border-trauma-border-strong px-3 py-2 font-bold";
const railIconSlot = "grid size-10 place-items-center";
const phoneIconSlot = "grid size-8 place-items-center [&>svg]:size-6";
const phoneTabLabel = "text-[11px] font-medium leading-none";
const railNavItemBase =
  "trauma-capability-touch-target group relative grid size-10 place-items-center rounded-full text-trauma-text-primary transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent";
const activeNavItem =
  "trauma-active-nav-item relative text-trauma-text-primary";
const railPopoverRoot = "relative grid place-items-center";
const railPopoverPanel =
  "w-[252px] max-w-[calc(100vw-4.5rem)] left-full bottom-0 top-auto ml-2 mt-0";
const phoneTabButton =
  "trauma-capability-touch-target flex min-h-[48px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-trauma-text-secondary transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent";

const BRIGHTNESS_STORAGE_KEY = "trauma:brightness";
const SURFACE_STORAGE_KEY = "trauma:surface";

const READER_RAIL_SCROLL_HIDE_DELTA = 8;
const READER_RAIL_SCROLL_HIDE_MIN_Y = 24;
const READER_RAIL_SCROLL_SHOW_DELTA = -8;
const READER_RAIL_LEFT_EDGE_PX = 24;

export function isMemoryReaderPath(pathname: string): boolean {
  if (!pathname.startsWith("/memories/")) {
    return false;
  }

  return pathname.split("/").filter(Boolean).length >= 2;
}

const railNavItems = [
  { href: "/memories", icon: "today", label: "Today", lane: "today" },
  {
    href: "/memories?lane=shelf",
    icon: "shelf",
    label: "Shelf",
    lane: "shelf",
  },
  {
    href: "/memories?lane=library",
    icon: "library",
    label: "Library",
    lane: "library",
  },
  { href: "/flashbacks", icon: "flashbacks", label: "Flashbacks" },
  { href: "/moments", icon: "moment", label: "Moments" },
  { href: "/settings", icon: "settings", label: "Settings" },
] as const satisfies readonly RouteNavItem[];

const phonePrimaryTabs = [
  { href: "/memories", icon: "today", label: "Today", lane: "today" },
  {
    href: "/memories?lane=shelf",
    icon: "shelf",
    label: "Shelf",
    lane: "shelf",
  },
  {
    href: "/memories?lane=library",
    icon: "library",
    label: "Library",
    lane: "library",
  },
] as const satisfies readonly RouteNavItem[];

const phoneMoreRoutes = [
  { href: "/flashbacks", icon: "flashbacks", label: "Flashbacks" },
  { href: "/moments", icon: "moment", label: "Moments" },
  { href: "/settings", icon: "settings", label: "Settings" },
] as const satisfies readonly RouteNavItem[];

function isRouteNavItemActive(
  item: RouteNavItem,
  pathname: string,
  search: string,
): boolean {
  if (item.lane !== undefined) {
    if (pathname === "/") {
      return item.lane === "today";
    }
    if (pathname !== "/memories") {
      return false;
    }
    const parsedLane = resolveBrowseLane(parseBrowseQuery(search));
    return parsedLane === item.lane;
  }

  return pathname.startsWith(item.href);
}

export function AppShell(props: AppShellProps) {
  const location = useLocation();
  const addMemorySubmission = createAddMemorySubmissionController({
    onBackupFailsafe: revalidateBackupFailsafeAlert,
    onCreationSettled: () => revalidateBrowseMemoryWorkspace(),
  });
  const [isHydrated, setIsHydrated] = createSignal(false);
  const [brightness, setBrightness] = createSignal<BrightnessMode>(
    DEFAULT_BRIGHTNESS_MODE,
  );
  const [surface, setSurface] = createSignal<SurfaceMode>(DEFAULT_SURFACE_MODE);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteInitialMode, setPaletteInitialMode] = createSignal<
    "search" | "capture"
  >("search");
  const [focusedMemoryId, setFocusedMemoryId] = createSignal<string | null>(
    null,
  );
  const [readerRailHidden, setReaderRailHidden] = createSignal(false);

  const backupFailsafeAlert = createAsync(() => getBackupFailsafeAlert());
  const activePath = createMemo(() => location.pathname);
  const activeSearch = createMemo(() => location.search);
  const isReaderRoute = createMemo(() => isMemoryReaderPath(activePath()));
  const isReaderRailHidden = createMemo(
    () => isReaderRoute() && readerRailHidden(),
  );

  let leftRailRef: HTMLElement | undefined;
  let previousFocusedElement: HTMLElement | null = null;

  const openCommandPalette = (mode: "search" | "capture" = "search") => {
    const active = document.activeElement;
    previousFocusedElement = active instanceof HTMLElement ? active : null;
    setFocusedMemoryId(extractFocusedMemoryId(activePath(), active));
    setPaletteInitialMode(mode);
    setPaletteOpen(true);
  };

  const closeCommandPalette = (restoreFocus: boolean) => {
    setPaletteOpen(false);
    const target = previousFocusedElement;
    previousFocusedElement = null;
    if (restoreFocus && target !== null && target.isConnected) {
      queueMicrotask(() => {
        if (target.isConnected) {
          target.focus({ preventScroll: true });
        }
      });
    }
  };

  onMount(() => {
    setBrightness(readStoredBrightness());
    setSurface(readStoredSurface());
    setIsHydrated(true);

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (isCommandPaletteShortcut(event)) {
        event.preventDefault();
        if (paletteOpen()) {
          closeCommandPalette(true);
        } else {
          openCommandPalette("search");
        }
        return;
      }

      if (
        event.key === "a" &&
        !event.defaultPrevented &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !paletteOpen() &&
        !isShellShortcutSuppressed(event.target)
      ) {
        event.preventDefault();
        openCommandPalette("capture");
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", handleGlobalKeyDown);
    });
  });

  createEffect(() => {
    if (!isHydrated()) {
      return;
    }

    const nextBrightness = brightness();
    const nextSurface = surface();
    const theme = themeFromPreference({
      brightness: nextBrightness,
      surface: nextSurface,
    });

    document.documentElement.setAttribute("data-theme", theme);
    writeLocalStorageItem(BRIGHTNESS_STORAGE_KEY, nextBrightness);
    writeLocalStorageItem(SURFACE_STORAGE_KEY, nextSurface);
  });

  // Reset reader rail visibility on route change and attach auto-hide listeners on reader routes.
  createEffect(() => {
    activePath();
    setReaderRailHidden(false);

    if (!isReaderRoute()) {
      return;
    }

    let lastScrollY = typeof window !== "undefined" ? window.scrollY : 0;

    const handleScroll = () => {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY;
      lastScrollY = currentY;

      if (
        delta >= READER_RAIL_SCROLL_HIDE_DELTA &&
        currentY > READER_RAIL_SCROLL_HIDE_MIN_Y
      ) {
        const focusInsideRail =
          leftRailRef !== undefined &&
          document.activeElement instanceof Node &&
          leftRailRef.contains(document.activeElement);
        if (!focusInsideRail) {
          setReaderRailHidden(true);
        }
      } else if (
        delta <= READER_RAIL_SCROLL_SHOW_DELTA ||
        currentY <= READER_RAIL_SCROLL_HIDE_DELTA
      ) {
        setReaderRailHidden(false);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.clientX <= READER_RAIL_LEFT_EDGE_PX) {
        setReaderRailHidden(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !paletteOpen() && readerRailHidden()) {
        setReaderRailHidden(false);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <div
      class="trauma-shell-frame trauma-mobile-stable-viewport grid bg-trauma-bg-base text-trauma-text-primary min-[721px]:grid-cols-[56px_minmax(0,1fr)] max-[720px]:block"
      data-shell-hydrated={isHydrated() ? "true" : "false"}
    >
      <PhoneBrandHeader
        onOpenCapture={() => openCommandPalette("capture")}
        onOpenPalette={() => openCommandPalette("search")}
      />
      <aside
        ref={leftRailRef}
        aria-label="Primary navigation"
        class={sideSurface}
        data-rail-hidden={isReaderRailHidden() ? "true" : "false"}
        onFocusIn={() => setReaderRailHidden(false)}
      >
        <NavigationContent
          activePath={activePath()}
          activeSearch={activeSearch()}
          addMemorySubmission={addMemorySubmission}
          brightness={brightness()}
          onOpenPalette={() => openCommandPalette("search")}
          onSetBrightness={setBrightness}
          onSetSurface={setSurface}
          surface={surface()}
        />
      </aside>
      <main class="trauma-shell-main mx-auto w-full max-w-[920px] min-w-0 max-[720px]:pb-[calc(4.75rem+var(--trauma-layout-safe-area-bottom))]">
        <Show when={backupFailsafeAlert()}>
          {(alert) => <BackupFailsafeBanner alert={alert()} />}
        </Show>
        {props.children}
      </main>
      <PhoneTabBar
        activePath={activePath()}
        activeSearch={activeSearch()}
        brightness={brightness()}
        onOpenCapture={() => openCommandPalette("capture")}
        onOpenPalette={() => openCommandPalette("search")}
        onSetBrightness={setBrightness}
        onSetSurface={setSurface}
        surface={surface()}
      />
      <CommandPalette
        addMemorySubmission={addMemorySubmission}
        focusedMemoryId={focusedMemoryId()}
        initialMode={paletteInitialMode()}
        open={paletteOpen()}
        onClose={closeCommandPalette}
      />
    </div>
  );
}

function PhoneBrandHeader(props: {
  onOpenCapture: () => void;
  onOpenPalette: () => void;
}) {
  return (
    <header class="trauma-safe-area-inline hidden min-h-[52px] items-center justify-between border-b border-trauma-border bg-trauma-bg-surface/95 px-3 py-1.5 backdrop-blur max-[720px]:flex">
      <BrandHomeLink markSize={26} />
      <div class="flex items-center gap-1">
        <button
          aria-label="Command palette"
          class={railNavItemBase}
          title="Command palette"
          type="button"
          onClick={props.onOpenPalette}
        >
          <SearchIcon size={20} />
          <span class="sr-only">Command palette</span>
        </button>
        <button
          aria-label="Add memory"
          class={railNavItemBase}
          title="Add memory"
          type="button"
          onClick={props.onOpenCapture}
        >
          <PlusIcon size={20} />
          <span class="sr-only">Add memory</span>
        </button>
      </div>
    </header>
  );
}

function BrandHomeLink(props: {
  class?: string;
  markSize?: number;
  onNavigate?: () => void;
}) {
  return (
    <A
      aria-label="TRAUMA home"
      class={`grid size-10 place-items-center rounded-full transition hover:bg-trauma-bg-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent ${props.class ?? ""}`}
      href="/memories"
      title="TRAUMA"
      onClick={props.onNavigate}
    >
      <span class={railIconSlot}>
        <TraumaMark size={props.markSize ?? 26} />
      </span>
    </A>
  );
}

function NavigationContent(props: {
  activePath: string;
  activeSearch: string;
  addMemorySubmission: AddMemorySubmissionController;
  brightness: BrightnessMode;
  onNavigate?: () => void;
  onOpenPalette: () => void;
  onSetBrightness: (mode: BrightnessMode) => void;
  onSetSurface: (mode: SurfaceMode) => void;
  surface: SurfaceMode;
}) {
  return (
    <div class="flex h-full min-h-0 flex-col items-center gap-1.5">
      <BrandHomeLink onNavigate={props.onNavigate} />
      <nav
        aria-label="Primary sections"
        class="grid justify-items-center gap-1"
      >
        <For each={railNavItems}>
          {(item) => (
            <RouteNavLink
              activePath={props.activePath}
              activeSearch={props.activeSearch}
              item={item}
              onNavigate={props.onNavigate}
            />
          )}
        </For>
      </nav>
      <div class="mt-auto grid justify-items-center gap-1">
        <button
          aria-label="Command palette"
          class={railNavItemBase}
          title="Command palette (⌘K)"
          type="button"
          onClick={props.onOpenPalette}
        >
          <span class={railIconSlot}>
            <SearchIcon size={22} />
          </span>
          <span class="sr-only">Command palette</span>
        </button>
        <AddMemoryComposerButton
          onCreated={props.onNavigate}
          popoverId="rail-add-memory-composer"
          submission={props.addMemorySubmission}
        />
        <ThemeNavButton
          brightness={props.brightness}
          onBrightness={props.onSetBrightness}
          onSurface={props.onSetSurface}
          popoverId="rail-theme-settings"
          surface={props.surface}
        />
      </div>
    </div>
  );
}

function RouteNavLink(props: {
  activePath: string;
  activeSearch: string;
  item: RouteNavItem;
  onNavigate?: () => void;
}) {
  const isActive = createMemo(() =>
    isRouteNavItemActive(props.item, props.activePath, props.activeSearch),
  );
  const icon = createMemo(
    () => TraumaNavIcons[props.item.icon][isActive() ? "filled" : "outline"],
  );

  return (
    <A
      aria-current={isActive() ? "page" : undefined}
      class={`${railNavItemBase} ${isActive() ? activeNavItem : ""}`}
      href={props.item.href}
      title={props.item.label}
      onClick={props.onNavigate}
    >
      <span class={railIconSlot}>{icon()({ size: 22 })}</span>
      <span class="sr-only">{props.item.label}</span>
    </A>
  );
}

function AddMemoryComposerButton(props: {
  onCreated?: () => void;
  popoverId: string;
  submission: AddMemorySubmissionController;
}) {
  return (
    <Popup
      class={railPopoverRoot}
      id={props.popoverId}
      label="Add memory"
      mode="dialog"
      panelClass="w-[min(320px,calc(100vw-4.5rem))] left-full bottom-0 top-auto ml-2 mt-0"
      placement="top-start"
      trigger={({ open, triggerProps }) => (
        <button
          {...triggerProps}
          aria-label="Add memory"
          aria-pressed={open}
          class={`${railNavItemBase} ${open ? activeNavItem : ""}`}
          title="Add memory"
          type="button"
        >
          <span class={railIconSlot}>
            <PlusIcon size={22} />
          </span>
          <span class="sr-only">Add memory</span>
        </button>
      )}
    >
      {({ close }) => (
        <div class="p-4">
          <AddMemoryForm
            buttonClass={composerSubmitButton}
            formClass="grid gap-3"
            inputClass={`${surfaceInput} w-full`}
            onCreated={() => {
              close();
              props.onCreated?.();
            }}
            showVisibleLabel={false}
            submission={props.submission}
            submitLabel="Save memory"
            title="Add memory"
          />
        </div>
      )}
    </Popup>
  );
}

function ThemeNavButton(props: {
  brightness: BrightnessMode;
  onBrightness: (mode: BrightnessMode) => void;
  onSurface: (mode: SurfaceMode) => void;
  popoverId: string;
  surface: SurfaceMode;
}) {
  return (
    <Popup
      class={railPopoverRoot}
      id={props.popoverId}
      label="Theme settings"
      mode="dialog"
      panelClass={railPopoverPanel}
      placement="top-start"
      trigger={({ open, triggerProps }) => {
        const Icon = TraumaNavIcons.theme[open ? "filled" : "outline"];
        return (
          <button
            {...triggerProps}
            aria-label="Theme"
            aria-pressed={open}
            class={`${railNavItemBase} ${open ? activeNavItem : ""}`}
            title="Theme settings"
            type="button"
          >
            <span class={railIconSlot}>{Icon({ size: 22 })}</span>
            <span class="sr-only">Theme</span>
          </button>
        );
      }}
    >
      {() => (
        <ThemeBlock
          brightness={props.brightness}
          onBrightness={props.onBrightness}
          onSurface={props.onSurface}
          surface={props.surface}
        />
      )}
    </Popup>
  );
}

function PhoneTabBar(props: {
  activePath: string;
  activeSearch: string;
  brightness: BrightnessMode;
  onOpenCapture: () => void;
  onOpenPalette: () => void;
  onSetBrightness: (mode: BrightnessMode) => void;
  onSetSurface: (mode: SurfaceMode) => void;
  surface: SurfaceMode;
}) {
  const isMoreRouteActive = createMemo(() =>
    phoneMoreRoutes.some((item) =>
      isRouteNavItemActive(item, props.activePath, props.activeSearch),
    ),
  );

  return (
    <nav
      aria-label="Primary tabs"
      class="trauma-safe-area-bottom fixed inset-x-0 bottom-0 z-40 hidden border-t border-trauma-border bg-trauma-bg-surface/95 px-2 pb-[max(0.5rem,var(--trauma-layout-safe-area-bottom))] pt-1.5 backdrop-blur max-[720px]:block"
    >
      <div class="grid grid-cols-4 items-center gap-1" data-phone-tab-bar>
        <For each={phonePrimaryTabs}>
          {(item) => (
            <PhoneRouteTab
              activePath={props.activePath}
              activeSearch={props.activeSearch}
              item={item}
            />
          )}
        </For>
        <Popup
          class="relative w-full"
          id="phone-more-sheet"
          label="More navigation"
          mode="dialog"
          phonePanel={true}
          trigger={({ open, triggerProps }) => {
            const active = open || isMoreRouteActive();
            const Icon = TraumaNavIcons.more[active ? "filled" : "outline"];
            return (
              <button
                {...triggerProps}
                aria-pressed={open}
                class={`${phoneTabButton} ${active ? activeNavItem : ""}`}
                data-phone-tab="more"
                type="button"
              >
                <span class={phoneIconSlot}>{Icon({ size: 24 })}</span>
                <span class={phoneTabLabel} data-phone-tab-label>
                  More
                </span>
              </button>
            );
          }}
        >
          {({ close }) => (
            <div class="grid gap-3 p-4">
              <nav aria-label="More sections" class="grid gap-1">
                <For each={phoneMoreRoutes}>
                  {(item) => {
                    const active = createMemo(() =>
                      isRouteNavItemActive(
                        item,
                        props.activePath,
                        props.activeSearch,
                      ),
                    );
                    const Icon = createMemo(
                      () =>
                        TraumaNavIcons[item.icon][
                          active() ? "filled" : "outline"
                        ],
                    );
                    return (
                      <A
                        aria-current={active() ? "page" : undefined}
                        class={`flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-trauma-text-primary transition hover:bg-trauma-bg-tint ${
                          active() ? "bg-trauma-bg-tint font-bold" : ""
                        }`}
                        href={item.href}
                        onClick={close}
                      >
                        <span class="grid size-6 place-items-center">
                          {Icon()({ size: 20 })}
                        </span>
                        <span>{item.label}</span>
                      </A>
                    );
                  }}
                </For>
              </nav>
              <div class="grid grid-cols-2 gap-2 border-t border-trauma-border pt-3">
                <button
                  class="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-trauma-border bg-trauma-bg-surface px-3 py-2 text-xs font-semibold text-trauma-text-primary transition hover:bg-trauma-bg-tint"
                  type="button"
                  onClick={() => {
                    close();
                    props.onOpenCapture();
                  }}
                >
                  <PlusIcon size={16} />
                  <span>Add URL</span>
                </button>
                <button
                  class="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-trauma-border bg-trauma-bg-surface px-3 py-2 text-xs font-semibold text-trauma-text-primary transition hover:bg-trauma-bg-tint"
                  type="button"
                  onClick={() => {
                    close();
                    props.onOpenPalette();
                  }}
                >
                  <SearchIcon size={16} />
                  <span>Search</span>
                </button>
              </div>
              <div class="border-t border-trauma-border pt-2">
                <ThemeBlock
                  brightness={props.brightness}
                  onBrightness={props.onSetBrightness}
                  onSurface={props.onSetSurface}
                  surface={props.surface}
                />
              </div>
            </div>
          )}
        </Popup>
      </div>
    </nav>
  );
}

function PhoneRouteTab(props: {
  activePath: string;
  activeSearch: string;
  item: RouteNavItem;
}) {
  const isActive = createMemo(() =>
    isRouteNavItemActive(props.item, props.activePath, props.activeSearch),
  );
  const icon = createMemo(
    () => TraumaNavIcons[props.item.icon][isActive() ? "filled" : "outline"],
  );

  return (
    <A
      aria-current={isActive() ? "page" : undefined}
      class={`${phoneTabButton} ${isActive() ? activeNavItem : ""}`}
      data-phone-tab={props.item.lane ?? props.item.icon}
      href={props.item.href}
    >
      <span class={phoneIconSlot}>{icon()({ size: 24 })}</span>
      <span class={phoneTabLabel} data-phone-tab-label>
        {props.item.label}
      </span>
    </A>
  );
}

function ThemeBlock(props: {
  brightness: BrightnessMode;
  onBrightness: (mode: BrightnessMode) => void;
  onSurface: (mode: SurfaceMode) => void;
  surface: SurfaceMode;
}) {
  const normalSurfaceLabel = createMemo(() =>
    getNormalSurfaceLabel(props.brightness),
  );
  const paperSurfaceLabel = createMemo(() =>
    getPaperSurfaceLabel(props.brightness),
  );
  const paperSurfaceIcon = createMemo(() =>
    props.brightness === "night" ? <HermesIcon /> : <PaperIcon />,
  );
  return (
    <section aria-label="Theme" class="grid w-full gap-1.5 px-2 py-2.5">
      <p class="text-[11px] font-bold uppercase text-trauma-text-muted">Theme</p>
      <div
        aria-label="Brightness"
        class="grid grid-cols-2 gap-1 rounded-full bg-trauma-bg-sunken p-1"
        role="group"
      >
        <SegmentedToggleButton
          active={props.brightness === "sun"}
          hint="Use sun theme"
          onClick={() => props.onBrightness("sun")}
        >
          <SunIcon />
          <span>Sun</span>
        </SegmentedToggleButton>
        <SegmentedToggleButton
          active={props.brightness === "night"}
          hint="Use night theme"
          onClick={() => props.onBrightness("night")}
        >
          <MoonIcon />
          <span>Night</span>
        </SegmentedToggleButton>
      </div>
      <div
        aria-label="Surface"
        class="grid grid-cols-2 gap-1 rounded-full bg-trauma-bg-sunken p-1"
        role="group"
      >
        <SegmentedToggleButton
          active={props.surface === "normal"}
          hint={`Use ${normalSurfaceLabel()} surface`}
          onClick={() => props.onSurface("normal")}
        >
          <PageIcon />
          <span>{normalSurfaceLabel()}</span>
        </SegmentedToggleButton>
        <SegmentedToggleButton
          active={props.surface === "paper"}
          hint={`Use ${paperSurfaceLabel()} surface`}
          onClick={() => props.onSurface("paper")}
        >
          {paperSurfaceIcon()}
          <span>{paperSurfaceLabel()}</span>
        </SegmentedToggleButton>
      </div>
    </section>
  );
}

function getNormalSurfaceLabel(
  brightness: BrightnessMode,
): "Light" | "Midnight" {
  return themeNameFromPreference({ brightness, surface: "normal" }) ===
    "midnight"
    ? "Midnight"
    : "Light";
}

function getPaperSurfaceLabel(brightness: BrightnessMode): "Paper" | "Hermès" {
  return themeNameFromPreference({ brightness, surface: "paper" }) === "hermes"
    ? "Hermès"
    : "Paper";
}

function readStoredBrightness(): BrightnessMode {
  const value = readLocalStorageItem(BRIGHTNESS_STORAGE_KEY);
  return value === "sun" || value === "night" ? value : DEFAULT_BRIGHTNESS_MODE;
}

function readStoredSurface(): SurfaceMode {
  const value = readLocalStorageItem(SURFACE_STORAGE_KEY);
  return value === "normal" || value === "paper" ? value : DEFAULT_SURFACE_MODE;
}

function readLocalStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Theme persistence is best-effort; blocked storage must not break shell hydration.
  }
}

function isShellShortcutSuppressed(target: EventTarget | null): boolean {
  const active = document.activeElement;
  if (isEditableElement(target) || isEditableElement(active)) {
    return true;
  }

  return document.querySelector('[role="dialog"], [role="menu"]') !== null;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.matches("input, textarea, select")
  );
}
