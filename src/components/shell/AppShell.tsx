import { A, createAsync, useLocation, useNavigate } from "@solidjs/router";
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
import { BackupFailsafeBanner } from "../backup/BackupFailsafeBanner";
import { TraumaMark } from "../brand/TraumaMark";
import {
  KebabIcon,
  HermesIcon,
  LockIcon,
  MoonIcon,
  PageIcon,
  PaperIcon,
  PlusIcon,
  SunIcon,
  TraumaNavIcons,
} from "../icons";
import { getBackupFailsafeAlert } from "../backup/backup-failsafe-loader";
import { getBrowseMemories } from "../memories/browse-loader";
import {
  buildBrowseHref,
  buildHighlightBrowseHref,
  getBrowseCategories,
  getBrowseTags,
  getRecentHighlights,
  parseBrowseQuery,
  type BrowseHighlight,
  type BrowseQuery,
  type BrowseTaxonomyItem,
} from "../memories/browse-data";
import {
  DEFAULT_BRIGHTNESS_MODE,
  DEFAULT_SURFACE_MODE,
  themeFromPreference,
  type BrightnessMode,
  type SurfaceMode,
} from "./theme";
import { RightRailContentContext } from "./right-rail-context";
import { WaxSealButton, WaxSealLabel } from "../ui/WaxSealButton";

interface AppShellProps {
  children: JSX.Element;
}

const buttonBase =
  "inline-flex min-h-[38px] items-center justify-center rounded-lg border border-trauma-border-strong px-3 py-2 font-bold";
const surfaceInput =
  "min-h-[42px] min-w-0 rounded-lg border border-trauma-border-strong bg-trauma-bg-surface px-3 text-trauma-text-primary placeholder:text-trauma-text-placeholder";
const sideSurface =
  "trauma-shell-left-rail sticky top-0 z-40 h-screen overflow-visible bg-trauma-bg-base max-[720px]:hidden";
const rightRailSurface =
  "trauma-shell-right-rail sticky top-0 h-screen overflow-hidden bg-trauma-bg-base px-6 py-4 max-[1040px]:hidden";
const rightRailStack =
  "flex h-full min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain pr-1";
const rightRailScrollContent =
  "max-h-[min(34vh,20rem)] overflow-y-auto overscroll-contain pr-1";
const composerSubmitButton =
  "inline-flex min-h-[38px] items-center justify-center rounded-full border border-trauma-border-strong px-3 py-2 font-bold";
const railIconSlot = "grid size-10 place-items-center";
const phoneIconSlot = "grid size-9 place-items-center [&>svg]:size-8";
const phoneTabLabel = "sr-only";
const compactRailItem =
  "max-[1040px]:mx-auto max-[1040px]:size-[52px] max-[1040px]:grid-cols-1 max-[1040px]:justify-items-center max-[1040px]:gap-0 max-[1040px]:px-0";
const navItemBase =
  `group grid min-h-12 w-max max-w-full grid-cols-[40px_minmax(0,1fr)] items-center gap-[18px] rounded-full px-2.5 py-2.5 pr-[18px] text-[19px] font-medium leading-[1.22] text-trauma-text-primary transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary ${compactRailItem}`;
const activeNavItem =
  "trauma-active-nav-item relative text-trauma-text-primary";
const disabledNavItem =
  "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-trauma-text-secondary";
const railPopoverRoot = "relative w-max max-w-full max-[1040px]:mx-auto";
const railPopoverPanel =
  "absolute left-0 top-full z-50 mt-1 w-[252px] max-w-[calc(100vw-2rem)] animate-trauma-pop-bounce max-[1040px]:left-full max-[1040px]:top-0 max-[1040px]:ml-2 max-[1040px]:mt-0";
const phoneTabButton =
  "trauma-capability-touch-target grid min-h-[52px] min-w-[4.75rem] shrink-0 place-items-center gap-0.5 rounded-2xl px-1 py-1 text-[11px] font-bold leading-tight text-trauma-text-secondary transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary aria-pressed:text-trauma-text-primary";
const phonePopoverPanel =
  "fixed inset-x-3 bottom-[calc(4.75rem+var(--trauma-layout-safe-area-bottom))] z-50 mx-auto w-[min(360px,calc(100vw-1.5rem))] animate-trauma-pop-bounce";
const themeToggleButton =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-bold text-trauma-text-secondary transition hover:bg-trauma-bg-tint aria-pressed:bg-trauma-bg-elev aria-pressed:text-trauma-text-primary aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-trauma-border-strong";
const railAddMemoryButton =
  "min-[1041px]:inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-trauma-accent px-4 py-2.5 text-[17px] font-extrabold text-trauma-accent-ink transition hover:bg-trauma-accent-hover max-[1040px]:hidden";
const compactAddMemoryButton =
  "min-[1041px]:hidden max-[1040px]:grid max-[1040px]:size-[52px] place-items-center rounded-full bg-trauma-accent text-trauma-accent-ink transition hover:bg-trauma-accent-hover aria-pressed:bg-trauma-accent-hover";
const BRIGHTNESS_STORAGE_KEY = "trauma:brightness";
const SURFACE_STORAGE_KEY = "trauma:surface";

const routeNavItems = [
  { href: "/memories", icon: "memories", label: "Memories", pip: false },
  { href: "/highlights", icon: "highlights", label: "Highlights", pip: true },
] as const;

const desktopFilterShortcutItems = [
  { icon: "categories", label: "Categories" },
  { icon: "tags", label: "Tags" },
] as const;

const futureNavItems = {
  backup: { icon: "backup", label: "Backup" },
  settings: { icon: "settings", label: "Settings" },
} as const;

const phoneTabItems = [
  { kind: "route", href: "/memories", icon: "memories", label: "Memories" },
  { kind: "route", href: "/highlights", icon: "highlights", label: "Highlights" },
  { kind: "disabled", icon: "categories", label: "Categories" },
  { kind: "disabled", icon: "tags", label: "Tags" },
  { kind: "disabled", icon: "backup", label: "Backup" },
  { kind: "composer", icon: "add", label: "Add memory" },
  { kind: "theme", icon: "theme", label: "Theme" },
  { kind: "disabled", icon: "settings", label: "Settings" },
] as const;

export function AppShell(props: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isHydrated, setIsHydrated] = createSignal(false);
  const [rightRailContent, setRightRailContent] = createSignal<
    JSX.Element | undefined
  >();
  const [brightness, setBrightness] = createSignal<BrightnessMode>(
    DEFAULT_BRIGHTNESS_MODE,
  );
  const [surface, setSurface] = createSignal<SurfaceMode>(DEFAULT_SURFACE_MODE);
  const memories = createAsync(() => getBrowseMemories());
  const backupFailsafeAlert = createAsync(() => getBackupFailsafeAlert());
  const browseMemories = createMemo(() => memories() ?? []);
  const query = createMemo(() => parseBrowseQuery(location.search));
  const categories = createMemo(() => getBrowseCategories(browseMemories()));
  const tags = createMemo(() => getBrowseTags(browseMemories()));
  const highlights = createMemo(() => getRecentHighlights(browseMemories()));
  const activePath = createMemo(() => location.pathname);

  onMount(() => {
    setBrightness(readStoredBrightness());
    setSurface(readStoredSurface());
    setIsHydrated(true);
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
    localStorage.setItem(BRIGHTNESS_STORAGE_KEY, nextBrightness);
    localStorage.setItem(SURFACE_STORAGE_KEY, nextSurface);
  });

  const goToFilter = (patch: Parameters<typeof buildBrowseHref>[1]) => {
    navigate(buildBrowseHref(query(), patch));
  };

  const goToHighlight = (highlightId: string) => {
    navigate(buildHighlightBrowseHref(highlightId));
  };

  const toggleFilter = (key: "category" | "tag" | "highlight", value: string) => {
    const patch = { [key]: query()[key] === value ? "" : value } satisfies Partial<BrowseQuery>;
    goToFilter(patch);
  };

  return (
    <RightRailContentContext.Provider
      value={{ rightRailContent, setRightRailContent }}
    >
      <div class="trauma-shell-frame trauma-mobile-stable-viewport grid min-h-screen justify-center bg-trauma-bg-base text-trauma-text-primary min-[1041px]:grid-cols-[275px_minmax(0,840px)_360px] max-[1040px]:grid-cols-[80px_minmax(0,1fr)] max-[720px]:block">
      <PhoneBrandHeader />
      <aside class={`${sideSurface} border-r border-trauma-border px-2 py-1 pb-3 max-[1040px]:row-span-2 max-[1040px]:px-2.5 max-[1040px]:py-4`} aria-label="Primary navigation">
        <NavigationContent
          activePath={activePath()}
          brightness={brightness()}
          onSetBrightness={setBrightness}
          onSetSurface={setSurface}
          surface={surface()}
        />
      </aside>
      <main class="trauma-shell-main min-w-0 border-r border-trauma-border max-[1040px]:col-start-2 max-[720px]:border-r-0 max-[720px]:pb-[calc(4.75rem+var(--trauma-layout-safe-area-bottom))]">
        <Show when={backupFailsafeAlert()}>
          {(alert) => <BackupFailsafeBanner alert={alert()} />}
        </Show>
        {props.children}
      </main>
      <aside class={rightRailSurface} aria-label="Browse filters">
        <div class={rightRailStack}>
          <Show when={rightRailContent()}>
            {(content) => <div class="shrink-0">{content()}</div>}
          </Show>
          <RightRailFilters
            activeCategory={query().category}
            activeHighlight={query().highlight}
            activeTag={query().tag}
            categories={categories()}
            highlights={highlights()}
            idPrefix="desktop"
            onSelectCategory={(category) => toggleFilter("category", category.id)}
            onSelectHighlight={(highlight) => goToHighlight(highlight.id)}
            onSelectTag={(tag) => toggleFilter("tag", tag.id)}
            tags={tags()}
          />
        </div>
      </aside>
      <PhoneTabBar
        activePath={activePath()}
        brightness={brightness()}
        onSetBrightness={setBrightness}
        onSetSurface={setSurface}
        surface={surface()}
      />
      </div>
    </RightRailContentContext.Provider>
  );
}

function PhoneBrandHeader() {
  return (
    <header class="trauma-safe-area-inline hidden min-h-[56px] items-center border-b border-trauma-border bg-trauma-bg-surface/95 px-3 py-2 backdrop-blur max-[720px]:grid">
      <BrandHomeLink markSize={28} showLabel={false} />
    </header>
  );
}

function BrandHomeLink(props: {
  class?: string;
  markSize?: number;
  onNavigate?: () => void;
  showLabel: boolean;
}) {
  return (
    <A
      aria-label="TRAUMA home"
      class={`inline-grid h-[52px] w-max grid-cols-[40px_minmax(0,1fr)] items-center gap-[18px] rounded-full px-2.5 text-[22px] font-extrabold max-[1040px]:mx-auto max-[1040px]:size-[52px] max-[1040px]:grid-cols-1 max-[1040px]:justify-items-center max-[1040px]:px-0 ${props.class ?? ""}`}
      href="/memories"
      onClick={props.onNavigate}
    >
      <span class={railIconSlot}>
        <TraumaMark size={props.markSize ?? 30} />
      </span>
      <Show when={props.showLabel}>
        <span class="max-[1040px]:hidden">TRAUMA</span>
      </Show>
    </A>
  );
}

function PhoneTabBar(props: {
  activePath: string;
  brightness: BrightnessMode;
  onCreated?: () => void;
  onSetBrightness: (mode: BrightnessMode) => void;
  onSetSurface: (mode: SurfaceMode) => void;
  surface: SurfaceMode;
}) {
  return (
    <nav
      aria-label="Primary tabs"
      class="trauma-safe-area-bottom fixed inset-x-0 bottom-0 z-40 hidden border-t border-trauma-border bg-trauma-bg-surface/95 px-2 pb-[max(0.5rem,var(--trauma-layout-safe-area-bottom))] pt-1.5 backdrop-blur max-[720px]:block"
    >
      <div
        class="flex items-end gap-1 overflow-x-auto overscroll-x-contain px-1 pb-0.5"
        data-phone-tab-scroll
      >
        <For each={phoneTabItems}>
          {(item) => renderPhoneTabItem(item, props)}
        </For>
      </div>
    </nav>
  );
}

function renderPhoneTabItem(
  item: (typeof phoneTabItems)[number],
  props: {
    activePath: string;
    brightness: BrightnessMode;
    onCreated?: () => void;
    onSetBrightness: (mode: BrightnessMode) => void;
    onSetSurface: (mode: SurfaceMode) => void;
    surface: SurfaceMode;
  },
) {
  switch (item.kind) {
    case "route":
      return <PhoneRouteTab activePath={props.activePath} item={item} />;
    case "disabled":
      return <PhoneDisabledTab item={item} />;
    case "composer":
      return (
        <AddMemoryComposerButton
          mode="phone"
          onCreated={props.onCreated}
          popoverId="phone-add-memory-composer"
        />
      );
    case "theme":
      return (
        <ThemeNavButton
          brightness={props.brightness}
          mode="phone"
          onBrightness={props.onSetBrightness}
          onSurface={props.onSetSurface}
          popoverId="phone-theme-settings"
          surface={props.surface}
        />
      );
  }
}

function PhoneRouteTab(props: {
  activePath: string;
  item: Extract<(typeof phoneTabItems)[number], { kind: "route" }>;
}) {
  const isActive = createMemo(() => {
    if (props.item.href === "/memories") {
      return props.activePath === "/" || props.activePath.startsWith("/memories");
    }

    return props.activePath.startsWith(props.item.href);
  });
  const icon = createMemo(
    () => TraumaNavIcons[props.item.icon][isActive() ? "filled" : "outline"],
  );

  return (
    <A
      aria-current={isActive() ? "page" : undefined}
      class={`${phoneTabButton} ${isActive() ? activeNavItem : ""}`}
      href={props.item.href}
    >
      <span class={phoneIconSlot}>{icon()}</span>
      <span class={phoneTabLabel} data-phone-tab-label>
        {props.item.label}
      </span>
    </A>
  );
}

function PhoneDisabledTab(props: {
  item: Extract<(typeof phoneTabItems)[number], { kind: "disabled" }>;
}) {
  const icon = createMemo(() => TraumaNavIcons[props.item.icon].outline);

  return (
    <button
      aria-disabled="true"
      class={`${phoneTabButton} cursor-not-allowed opacity-45 hover:bg-transparent hover:text-trauma-text-secondary`}
      disabled
      type="button"
    >
      <span class={phoneIconSlot}>{icon()}</span>
      <span class={phoneTabLabel} data-phone-tab-label>
        {props.item.label}
      </span>
    </button>
  );
}

function NavigationContent(props: {
  activePath: string;
  brightness: BrightnessMode;
  onNavigate?: () => void;
  onSetBrightness: (mode: BrightnessMode) => void;
  onSetSurface: (mode: SurfaceMode) => void;
  surface: SurfaceMode;
}) {
  return (
    <div
      class="flex flex-col gap-1.5"
      classList={{
        "min-h-[calc(100svh-48px)] max-[1040px]:min-h-[calc(100svh-32px)]": true,
      }}
    >
      <BrandHomeLink onNavigate={props.onNavigate} showLabel={true} />
      <nav class="grid content-start gap-1" aria-label="Primary sections">
        <For each={routeNavItems}>
          {(item) => (
            <RouteNavLink
              activePath={props.activePath}
              item={item}
              onNavigate={props.onNavigate}
            />
          )}
        </For>
        <For each={desktopFilterShortcutItems}>
          {(item) => <RightRailShortcutButton item={item} />}
        </For>
        <FutureNavButton item={futureNavItems.backup} />
        <ThemeNavButton
          brightness={props.brightness}
          mode="rail"
          onBrightness={props.onSetBrightness}
          onSurface={props.onSetSurface}
          popoverId="rail-theme-settings"
          surface={props.surface}
        />
        <FutureNavButton item={futureNavItems.settings} />
      </nav>
      <AddMemoryComposerButton
        mode="rail"
        onCreated={props.onNavigate}
        popoverId="rail-add-memory-composer"
      />
      <button type="button" class="mt-auto grid min-h-[60px] grid-cols-[40px_minmax(0,1fr)_20px] items-center gap-2.5 rounded-full bg-transparent px-3 py-2.5 text-left text-trauma-text-primary transition hover:bg-trauma-bg-tint max-[1040px]:mx-auto max-[1040px]:size-12 max-[1040px]:grid-cols-1 max-[1040px]:justify-items-center max-[1040px]:px-0" aria-label="Local archive">
        <span class={`${railIconSlot} rounded-full bg-trauma-accent-soft`}>
          <TraumaMark size={26} />
        </span>
        <span class="min-w-0 max-[1040px]:sr-only">
          <strong class="flex items-center gap-1 text-sm text-trauma-text-primary">
            Local archive <LockIcon />
          </strong>
          <small class="block truncate text-xs text-trauma-text-muted">./data/storage</small>
        </span>
        <span class="max-[1040px]:hidden">
          <KebabIcon size={16} />
        </span>
      </button>
    </div>
  );
}

function AddMemoryComposerButton(props: {
  mode: "phone" | "rail";
  onCreated?: () => void;
  popoverId: string;
}) {
  let rootRef: HTMLDivElement | undefined;
  const [isComposerOpen, setIsComposerOpen] = createSignal(false);

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        rootRef === undefined ||
        !(target instanceof Node) ||
        rootRef.contains(target)
      ) {
        return;
      }

      setIsComposerOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsComposerOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  const handleCreated = () => {
    setIsComposerOpen(false);
    props.onCreated?.();
  };
  const isPhone = () => props.mode === "phone";
  const toggleComposer = () => setIsComposerOpen((value) => !value);

  return (
    <div
      ref={rootRef}
      class={
        isPhone()
          ? "relative min-w-[4.75rem] shrink-0"
          : "relative mx-1 my-3.5 w-[calc(100%-8px)] max-[1040px]:mx-auto max-[1040px]:my-3.5 max-[1040px]:w-[52px]"
      }
    >
      <Show
        when={isPhone()}
        fallback={
          <>
            <WaxSealButton
              aria-controls={isComposerOpen() ? props.popoverId : undefined}
              aria-expanded={isComposerOpen()}
              aria-haspopup="dialog"
              aria-pressed={isComposerOpen()}
              class={railAddMemoryButton}
              type="button"
              variant="command"
              onClick={toggleComposer}
            >
              <PlusIcon />
              <WaxSealLabel>Add memory</WaxSealLabel>
            </WaxSealButton>
            <button
              aria-controls={isComposerOpen() ? props.popoverId : undefined}
              aria-expanded={isComposerOpen()}
              aria-haspopup="dialog"
              aria-pressed={isComposerOpen()}
              class={compactAddMemoryButton}
              type="button"
              onClick={toggleComposer}
            >
              <PlusIcon size={28} />
              <span class="sr-only">Add memory</span>
            </button>
          </>
        }
      >
        <button
          aria-controls={isComposerOpen() ? props.popoverId : undefined}
          aria-expanded={isComposerOpen()}
          aria-haspopup="dialog"
          aria-pressed={isComposerOpen()}
          class={`${phoneTabButton} w-full`}
          type="button"
          onClick={toggleComposer}
        >
          <span class={phoneIconSlot}>
            <PlusIcon size={28} />
          </span>
          <span class={phoneTabLabel} data-phone-tab-label>
            Add memory
          </span>
        </button>
      </Show>
      <Show when={isComposerOpen()}>
        <div
          aria-label="Add memory"
          class={isPhone() ? phonePopoverPanel : "absolute left-0 top-full z-50 mt-1 w-[min(320px,calc(100vw-2rem))] animate-trauma-pop-bounce"}
          id={props.popoverId}
          role="dialog"
        >
          <AddMemoryForm
            formClass="grid gap-3.5 rounded-2xl border border-trauma-border bg-trauma-bg-elev p-4 shadow-trauma-2"
            inputClass={surfaceInput}
            buttonClass={`${composerSubmitButton} w-full bg-trauma-accent text-trauma-accent-ink hover:bg-trauma-accent-hover`}
            submitLabel="Save memory"
            title="Add memory"
            onCreated={handleCreated}
          />
        </div>
      </Show>
    </div>
  );
}

function RightRailFilters(props: {
  activeCategory: string;
  activeHighlight: string;
  activeTag: string;
  categories: BrowseTaxonomyItem[];
  highlights: BrowseHighlight[];
  idPrefix: string;
  onSelectCategory: (category: BrowseTaxonomyItem) => void;
  onSelectHighlight: (highlight: BrowseHighlight) => void;
  onSelectTag: (tag: BrowseTaxonomyItem) => void;
  tags: BrowseTaxonomyItem[];
}) {
  return (
    <div class="grid gap-4">
      <RightPanelSection title="Categories" titleId={`${props.idPrefix}-category-filters-title`}>
        <div class="grid gap-2">
          <For each={props.categories}>
            {(category) => (
              <button
                class={`${buttonBase} w-full justify-start border-trauma-border bg-transparent text-left text-trauma-text-primary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink`}
                type="button"
                aria-pressed={props.activeCategory === category.id}
                onClick={() => props.onSelectCategory(category)}
              >
                {category.name}
              </button>
            )}
          </For>
        </div>
      </RightPanelSection>
      <RightPanelSection title="Tags" titleId={`${props.idPrefix}-tag-filters-title`}>
        <div class="grid gap-2">
          <For each={props.tags}>
            {(tag) => (
              <button class={`${buttonBase} w-full justify-start border-trauma-border bg-transparent text-left text-trauma-text-primary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink`} type="button" aria-pressed={props.activeTag === tag.id} onClick={() => props.onSelectTag(tag)}>
                {tag.name}
              </button>
            )}
          </For>
        </div>
      </RightPanelSection>
      <RightPanelSection title="Recent highlights" titleId={`${props.idPrefix}-highlight-shortcuts-title`}>
        <div class={`${rightRailScrollContent} grid gap-3`}>
          <For each={props.highlights}>
            {(highlight) => (
              <button
                class="grid w-full gap-1 rounded-2xl px-3 py-2 text-left text-trauma-text-primary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink"
                type="button"
                aria-pressed={props.activeHighlight === highlight.id}
                onClick={() => props.onSelectHighlight(highlight)}
              >
                <span class="wrap-anywhere">{highlight.text}</span>
                <small class="text-xs font-semibold text-trauma-text-muted">{highlight.prefix}</small>
              </button>
            )}
          </For>
        </div>
      </RightPanelSection>
    </div>
  );
}

function RightPanelSection(props: {
  children: JSX.Element;
  title: string;
  titleId: string;
}) {
  return (
    <section
      aria-labelledby={props.titleId}
      class="rounded-[20px] border border-trauma-border bg-trauma-bg-base p-5"
    >
      <h2 class="mb-4 text-[20px] font-extrabold" id={props.titleId}>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function RouteNavLink(props: {
  activePath: string;
  item: (typeof routeNavItems)[number];
  onNavigate?: () => void;
}) {
  const isActive = createMemo(() => {
    if (props.item.href === "/memories") {
      return props.activePath === "/" || props.activePath.startsWith("/memories");
    }

    return props.activePath.startsWith(props.item.href);
  });
  const icon = createMemo(
    () => TraumaNavIcons[props.item.icon][isActive() ? "filled" : "outline"],
  );

  return (
    <A
      aria-current={isActive() ? "page" : undefined}
      class={`${navItemBase} ${isActive() ? activeNavItem : ""}`}
      href={props.item.href}
      onClick={props.onNavigate}
    >
      <span class={railIconSlot}>{icon()}</span>
      <span class="min-w-0 truncate max-[1040px]:sr-only">
        <span
          class={`trauma-active-nav-label ${isActive() ? "font-bold" : ""}`}
        >
          {props.item.label}
        </span>
        <Show when={props.item.pip}>
          <span class="ml-2 inline-block size-2 rounded-full bg-trauma-accent align-middle" aria-label="unread" />
        </Show>
      </span>
    </A>
  );
}

function RightRailShortcutButton(props: {
  item: (typeof desktopFilterShortcutItems)[number];
}) {
  const icon = createMemo(() => TraumaNavIcons[props.item.icon].outline);
  const href = createMemo(() =>
    props.item.icon === "categories"
      ? "#desktop-category-filters-title"
      : "#desktop-tag-filters-title",
  );

  return (
    <a class={`${navItemBase} max-[1040px]:hidden`} href={href()}>
      <span class={railIconSlot}>{icon()}</span>
      <span class="min-w-0 truncate max-[1040px]:sr-only">{props.item.label}</span>
    </a>
  );
}

function FutureNavButton(props: {
  item: (typeof futureNavItems)[keyof typeof futureNavItems];
}) {
  const icon = createMemo(() => TraumaNavIcons[props.item.icon].outline);

  return (
    <button
      aria-disabled="true"
      class={`${navItemBase} ${disabledNavItem}`}
      disabled
      type="button"
    >
      <span class={railIconSlot}>{icon()}</span>
      <span class="min-w-0 truncate max-[1040px]:sr-only">{props.item.label}</span>
    </button>
  );
}

function ThemeNavButton(props: {
  brightness: BrightnessMode;
  mode: "phone" | "rail";
  onBrightness: (mode: BrightnessMode) => void;
  onSurface: (mode: SurfaceMode) => void;
  popoverId: string;
  surface: SurfaceMode;
}) {
  let rootRef: HTMLDivElement | undefined;
  const [isThemeOpen, setIsThemeOpen] = createSignal(false);
  const isPhone = () => props.mode === "phone";
  const icon = createMemo(() =>
    props.brightness === "night" ? (
      <MoonIcon size={isPhone() ? 28 : undefined} />
    ) : (
      <SunIcon size={isPhone() ? 28 : undefined} />
    ),
  );

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        rootRef === undefined ||
        !(target instanceof Node) ||
        rootRef.contains(target)
      ) {
        return;
      }

      setIsThemeOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsThemeOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <div
      ref={rootRef}
      class={isPhone() ? "relative min-w-[4.75rem] shrink-0" : railPopoverRoot}
    >
      <button
        aria-controls={isThemeOpen() ? props.popoverId : undefined}
        aria-expanded={isThemeOpen()}
        aria-haspopup="dialog"
        aria-pressed={isThemeOpen()}
        class={`${isPhone() ? `${phoneTabButton} w-full` : navItemBase} ${isThemeOpen() ? activeNavItem : ""}`}
        type="button"
        onClick={() => setIsThemeOpen((value) => !value)}
      >
        <span class={isPhone() ? phoneIconSlot : railIconSlot}>{icon()}</span>
        <Show
          when={isPhone()}
          fallback={
            <span
              class="min-w-0 truncate max-[1040px]:sr-only"
            >
              <span
                class={`trauma-active-nav-label ${isThemeOpen() ? "font-bold" : ""}`}
              >
                Theme
              </span>
            </span>
          }
        >
          <span class={phoneTabLabel} data-phone-tab-label>
            Theme
          </span>
        </Show>
      </button>
      <Show when={isThemeOpen()}>
        <div
          aria-label="Theme settings"
          class={isPhone() ? phonePopoverPanel : railPopoverPanel}
          id={props.popoverId}
          role="dialog"
        >
          <ThemeBlock
            brightness={props.brightness}
            onBrightness={props.onBrightness}
            onSurface={props.onSurface}
            surface={props.surface}
          />
        </div>
      </Show>
    </div>
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
    <section class="grid w-full gap-1.5 rounded-2xl border border-trauma-border bg-trauma-bg-elev px-2 py-2.5 shadow-trauma-2" aria-label="Theme">
      <p class="text-[11px] font-bold uppercase text-trauma-text-muted">Theme</p>
      <div class="grid grid-cols-2 gap-1 rounded-full bg-trauma-bg-sunken p-1" role="group" aria-label="Brightness">
        <button
          aria-pressed={props.brightness === "sun"}
          class={themeToggleButton}
          type="button"
          onClick={() => props.onBrightness("sun")}
        >
          <SunIcon />
          <span>Sun</span>
        </button>
        <button
          aria-pressed={props.brightness === "night"}
          class={themeToggleButton}
          type="button"
          onClick={() => props.onBrightness("night")}
        >
          <MoonIcon />
          <span>Night</span>
        </button>
      </div>
      <div class="grid grid-cols-2 gap-1 rounded-full bg-trauma-bg-sunken p-1" role="group" aria-label="Surface">
        <button
          aria-pressed={props.surface === "normal"}
          class={themeToggleButton}
          type="button"
          onClick={() => props.onSurface("normal")}
        >
          <PageIcon />
          <span>{normalSurfaceLabel()}</span>
        </button>
        <button
          aria-pressed={props.surface === "paper"}
          class={themeToggleButton}
          type="button"
          onClick={() => props.onSurface("paper")}
        >
          {paperSurfaceIcon()}
          <span>{paperSurfaceLabel()}</span>
        </button>
      </div>
    </section>
  );
}

function getNormalSurfaceLabel(brightness: BrightnessMode): "Light" | "Midnight" {
  return brightness === "night" ? "Midnight" : "Light";
}

function getPaperSurfaceLabel(brightness: BrightnessMode): "Paper" | "Hermès" {
  return brightness === "night" ? "Hermès" : "Paper";
}

function readStoredBrightness(): BrightnessMode {
  const value = localStorage.getItem(BRIGHTNESS_STORAGE_KEY);
  return value === "sun" || value === "night" ? value : DEFAULT_BRIGHTNESS_MODE;
}

function readStoredSurface(): SurfaceMode {
  const value = localStorage.getItem(SURFACE_STORAGE_KEY);
  return value === "normal" || value === "paper" ? value : DEFAULT_SURFACE_MODE;
}
