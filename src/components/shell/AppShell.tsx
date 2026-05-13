import { A, createAsync, useLocation, useNavigate } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  type JSX,
} from "solid-js";

import { AddMemoryForm } from "../memories/AddMemoryForm";
import { BackupFailsafeBanner } from "../backup/BackupFailsafeBanner";
import { TraumaMark } from "../brand/TraumaMark";
import {
  KebabIcon,
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

interface AppShellProps {
  children: JSX.Element;
}

const buttonBase =
  "inline-flex min-h-[38px] items-center justify-center rounded-lg border border-trauma-border-strong px-3 py-2 font-bold";
const surfaceInput =
  "min-h-[42px] min-w-0 rounded-lg border border-trauma-border-strong bg-trauma-bg-surface px-3 text-trauma-text-primary placeholder:text-trauma-text-placeholder";
const sideSurface =
  "sticky top-0 h-screen overflow-y-auto bg-trauma-bg-base max-[720px]:hidden";
const rightRailSurface =
  "sticky top-0 h-screen overflow-hidden bg-trauma-bg-base px-6 py-4 max-[1040px]:hidden";
const rightRailStack =
  "flex h-full min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain pr-1";
const rightRailScrollContent =
  "max-h-[min(34vh,20rem)] overflow-y-auto overscroll-contain pr-1";
const iconButton =
  "inline-flex size-11 items-center justify-center rounded-full border border-trauma-border bg-trauma-bg-elev text-trauma-text-primary transition hover:bg-trauma-bg-tint";
const navItemBase =
  "group grid min-h-12 w-max max-w-full grid-cols-[32px_minmax(0,1fr)] items-center gap-[18px] rounded-full px-3 py-2.5 pr-[18px] text-[19px] font-medium leading-none text-trauma-text-primary transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary max-[1040px]:mx-auto max-[1040px]:size-12 max-[1040px]:grid-cols-1 max-[1040px]:justify-items-center max-[1040px]:gap-0 max-[1040px]:px-0";
const activeNavItem =
  "bg-trauma-accent-soft font-bold text-trauma-accent-soft-ink hover:bg-trauma-accent-soft hover:text-trauma-accent-soft-ink";
const disabledNavItem =
  "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-trauma-text-secondary";
const themeToggleButton =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-bold text-trauma-text-secondary transition hover:bg-trauma-bg-tint aria-pressed:bg-trauma-bg-elev aria-pressed:text-trauma-text-primary aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-trauma-border-strong max-[1040px]:size-10 max-[1040px]:px-0";
const BRIGHTNESS_STORAGE_KEY = "trauma:brightness";
const SURFACE_STORAGE_KEY = "trauma:surface";

const routeNavItems = [
  { href: "/memories", icon: "memories", label: "Memories", pip: false },
  { href: "/highlights", icon: "highlights", label: "Highlights", pip: true },
] as const;

const filterNavItems = [
  { icon: "categories", label: "Categories" },
  { icon: "tags", label: "Tags" },
] as const;

const futureNavItems = [
  { icon: "backup", label: "Backup" },
  { icon: "settings", label: "Settings" },
] as const;

export function AppShell(props: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isNavigationOpen, setIsNavigationOpen] = createSignal(false);
  const [isFiltersOpen, setIsFiltersOpen] = createSignal(false);
  const [isComposerOpen, setIsComposerOpen] = createSignal(false);
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
    setIsFiltersOpen(false);
  };

  const goToHighlight = (highlightId: string) => {
    navigate(buildHighlightBrowseHref(highlightId));
    setIsFiltersOpen(false);
  };

  const toggleFilter = (key: "category" | "tag" | "highlight", value: string) => {
    const patch = { [key]: query()[key] === value ? "" : value } satisfies Partial<BrowseQuery>;
    goToFilter(patch);
  };

  const closeNavigation = () => setIsNavigationOpen(false);

  const openComposer = () => {
    setIsNavigationOpen(false);
    setIsComposerOpen(true);
  };

  const openFilters = () => {
    setIsNavigationOpen(false);
    setIsFiltersOpen(true);
  };

  return (
    <RightRailContentContext.Provider
      value={{ rightRailContent, setRightRailContent }}
    >
      <div class="grid min-h-screen justify-center bg-trauma-bg-base text-trauma-text-primary min-[1041px]:grid-cols-[275px_minmax(0,840px)_360px] max-[1040px]:grid-cols-[80px_minmax(0,1fr)] max-[1040px]:grid-rows-[auto_1fr] max-[720px]:block">
      <MobileTopBar
        onOpenNavigation={() => setIsNavigationOpen(true)}
        onOpenFilters={() => setIsFiltersOpen(true)}
      />
      <aside class={`${sideSurface} border-r border-trauma-border px-2 py-1 pb-3 max-[1040px]:row-span-2 max-[1040px]:px-2.5 max-[1040px]:py-4`} aria-label="Primary navigation">
        <NavigationContent
          activePath={activePath()}
          brightness={brightness()}
          onOpenComposer={openComposer}
          onOpenFilters={openFilters}
          onSetBrightness={setBrightness}
          onSetSurface={setSurface}
          surface={surface()}
        />
      </aside>
      <main class="min-w-0 border-r border-trauma-border max-[1040px]:col-start-2 max-[720px]:border-r-0">
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
          <FilterPanel
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
      <Show when={isNavigationOpen()}>
        <Drawer ariaLabel="Navigation" onClose={() => setIsNavigationOpen(false)}>
          <NavigationContent
            activePath={activePath()}
            brightness={brightness()}
            isDrawer
            onNavigate={closeNavigation}
            onOpenComposer={openComposer}
            onOpenFilters={openFilters}
            onSetBrightness={setBrightness}
            onSetSurface={setSurface}
            surface={surface()}
          />
        </Drawer>
      </Show>
      <Show when={isFiltersOpen()}>
        <Drawer ariaLabel="Filters" onClose={() => setIsFiltersOpen(false)}>
          <FilterPanel
            activeCategory={query().category}
            activeHighlight={query().highlight}
            activeTag={query().tag}
            categories={categories()}
            highlights={highlights()}
            idPrefix="drawer"
            onSelectCategory={(category) => toggleFilter("category", category.id)}
            onSelectHighlight={(highlight) => goToHighlight(highlight.id)}
            onSelectTag={(tag) => toggleFilter("tag", tag.id)}
            tags={tags()}
          />
        </Drawer>
      </Show>
      <Show when={isComposerOpen()}>
        <Drawer ariaLabel="Add memory" onClose={() => setIsComposerOpen(false)}>
          <GlobalAddMemoryComposer onCreated={() => setIsComposerOpen(false)} />
        </Drawer>
      </Show>
      </div>
    </RightRailContentContext.Provider>
  );
}

function MobileTopBar(props: { onOpenNavigation: () => void; onOpenFilters: () => void }) {
  return (
    <header class="sticky top-0 z-10 col-start-2 hidden min-h-[58px] grid-cols-[minmax(0,1fr)_112px] items-center gap-2 border-b border-trauma-border bg-trauma-bg-surface/95 px-3 py-2 backdrop-blur max-[1040px]:grid max-[720px]:grid-cols-[96px_minmax(0,1fr)_96px]">
      <button type="button" class={`${iconButton} hidden w-full max-[720px]:inline-flex`} aria-label="Open navigation" onClick={props.onOpenNavigation}>
        <TraumaMark size={24} />
      </button>
      <A class="inline-flex min-h-10 min-w-0 items-center gap-2 text-[22px] font-extrabold max-[1040px]:text-xl max-[720px]:justify-center" href="/memories">
        <TraumaMark class="max-[720px]:hidden" size={28} />
        TRAUMA
      </A>
      <button type="button" class={`${buttonBase} w-full overflow-hidden bg-trauma-bg-elev text-trauma-accent hover:bg-trauma-bg-tint`} aria-label="Open filters" onClick={props.onOpenFilters}>
        Filter
      </button>
    </header>
  );
}

function NavigationContent(props: {
  activePath: string;
  brightness: BrightnessMode;
  isDrawer?: boolean;
  onNavigate?: () => void;
  onOpenComposer: () => void;
  onOpenFilters: () => void;
  onSetBrightness: (mode: BrightnessMode) => void;
  onSetSurface: (mode: SurfaceMode) => void;
  surface: SurfaceMode;
}) {
  return (
    <div
      class="flex flex-col gap-1.5"
      classList={{
        "min-h-0": props.isDrawer === true,
        "min-h-[calc(100vh-48px)] max-[1040px]:min-h-[calc(100vh-32px)]": props.isDrawer !== true,
      }}
    >
      <A
        aria-label="TRAUMA home"
        class="inline-flex h-[52px] w-max items-center gap-3 rounded-full px-1 text-[22px] font-extrabold max-[1040px]:justify-center max-[1040px]:px-0"
        href="/memories"
        onClick={props.onNavigate}
      >
        <TraumaMark size={36} />
        <span class="max-[1040px]:sr-only">TRAUMA</span>
      </A>
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
        <For each={filterNavItems}>
          {(item) => <FilterNavButton item={item} onOpen={props.onOpenFilters} />}
        </For>
        <For each={futureNavItems}>
          {(item) => <FutureNavButton item={item} />}
        </For>
      </nav>
      <button class="mx-1 my-3.5 inline-flex min-h-[52px] w-[calc(100%-8px)] items-center justify-center gap-2 rounded-full bg-trauma-accent px-4 py-2.5 text-[17px] font-extrabold text-trauma-accent-ink shadow-trauma-1 transition hover:bg-trauma-accent-hover max-[1040px]:mx-auto max-[1040px]:my-3.5 max-[1040px]:size-[52px] max-[1040px]:w-[52px] max-[1040px]:px-0" type="button" onClick={props.onOpenComposer}>
        <PlusIcon />
        <span class="max-[1040px]:sr-only">Add memory</span>
      </button>
      <ThemeBlock
        brightness={props.brightness}
        onBrightness={props.onSetBrightness}
        onSurface={props.onSetSurface}
        surface={props.surface}
      />
      <button type="button" class="grid min-h-[60px] grid-cols-[40px_minmax(0,1fr)_20px] items-center gap-2.5 rounded-full bg-transparent px-3 py-2.5 text-left text-trauma-text-primary transition hover:bg-trauma-bg-tint max-[1040px]:mx-auto max-[1040px]:size-12 max-[1040px]:grid-cols-1 max-[1040px]:justify-items-center max-[1040px]:px-0" aria-label="Local archive">
        <span class="grid size-10 place-items-center rounded-full bg-trauma-accent-soft">
          <TraumaMark size={26} />
        </span>
        <span class="min-w-0 max-[1040px]:sr-only">
          <strong class="flex items-center gap-1 text-sm text-trauma-text-primary">
            Local archive <LockIcon />
          </strong>
          <small class="block truncate text-xs text-trauma-text-muted">./data/storage</small>
        </span>
        <KebabIcon size={16} />
      </button>
    </div>
  );
}

function GlobalAddMemoryComposer(props: { onCreated: () => void }) {
  return (
    <AddMemoryForm
      formClass="grid gap-3.5"
      inputClass={surfaceInput}
      buttonClass={`${buttonBase} bg-trauma-accent text-trauma-accent-ink hover:bg-trauma-accent-hover`}
      submitLabel="Save memory"
      title="Add memory"
      onCreated={props.onCreated}
    />
  );
}

function FilterPanel(props: {
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
      class="rounded-[32px] border border-trauma-border bg-trauma-bg-base p-5"
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
      <span class="grid place-items-center">{icon()}</span>
      <span class="min-w-0 truncate max-[1040px]:sr-only">
        {props.item.label}
        <Show when={props.item.pip}>
          <span class="ml-2 inline-block size-2 rounded-full bg-trauma-accent align-middle" aria-label="unread" />
        </Show>
      </span>
    </A>
  );
}

function FilterNavButton(props: {
  item: (typeof filterNavItems)[number];
  onOpen: () => void;
}) {
  const icon = createMemo(() => TraumaNavIcons[props.item.icon].outline);

  return (
    <button class={navItemBase} type="button" onClick={props.onOpen}>
      <span class="grid place-items-center">{icon()}</span>
      <span class="min-w-0 truncate max-[1040px]:sr-only">{props.item.label}</span>
    </button>
  );
}

function FutureNavButton(props: { item: (typeof futureNavItems)[number] }) {
  const icon = createMemo(() => TraumaNavIcons[props.item.icon].outline);

  return (
    <button
      aria-disabled="true"
      class={`${navItemBase} ${disabledNavItem}`}
      disabled
      type="button"
    >
      <span class="grid place-items-center">{icon()}</span>
      <span class="min-w-0 truncate max-[1040px]:sr-only">{props.item.label}</span>
    </button>
  );
}

function ThemeBlock(props: {
  brightness: BrightnessMode;
  onBrightness: (mode: BrightnessMode) => void;
  onSurface: (mode: SurfaceMode) => void;
  surface: SurfaceMode;
}) {
  return (
    <section class="mt-auto grid gap-1.5 rounded-2xl border border-trauma-border bg-trauma-bg-elev px-2 py-2.5 max-[1040px]:mx-auto max-[1040px]:w-12 max-[1040px]:border-0 max-[1040px]:bg-transparent max-[1040px]:p-0" aria-label="Theme">
      <p class="text-[11px] font-bold uppercase text-trauma-text-muted max-[1040px]:sr-only">Theme</p>
      <div class="grid grid-cols-2 gap-1 rounded-full bg-trauma-bg-sunken p-1 max-[1040px]:grid-cols-1" role="group" aria-label="Brightness">
        <button
          aria-pressed={props.brightness === "sun"}
          class={themeToggleButton}
          type="button"
          onClick={() => props.onBrightness("sun")}
        >
          <SunIcon />
          <span class="max-[1040px]:sr-only">Sun</span>
        </button>
        <button
          aria-pressed={props.brightness === "night"}
          class={themeToggleButton}
          type="button"
          onClick={() => props.onBrightness("night")}
        >
          <MoonIcon />
          <span class="max-[1040px]:sr-only">Night</span>
        </button>
      </div>
      <div class="grid grid-cols-2 gap-1 rounded-full bg-trauma-bg-sunken p-1 max-[1040px]:grid-cols-1" role="group" aria-label="Surface">
        <button
          aria-pressed={props.surface === "normal"}
          class={themeToggleButton}
          type="button"
          onClick={() => props.onSurface("normal")}
        >
          <PageIcon />
          <span class="max-[1040px]:sr-only">Normal</span>
        </button>
        <button
          aria-pressed={props.surface === "paper"}
          class={themeToggleButton}
          type="button"
          onClick={() => props.onSurface("paper")}
        >
          <PaperIcon />
          <span class="max-[1040px]:sr-only">Paper</span>
        </button>
      </div>
    </section>
  );
}

function Drawer(props: { ariaLabel: string; children: JSX.Element; onClose: () => void }) {
  return (
    <div class="fixed inset-0 z-20 bg-gray-900/45">
      <div class="max-h-screen min-h-screen w-[min(86vw,360px)] overflow-y-auto bg-trauma-bg-surface p-[18px] shadow-trauma-drawer" role="dialog" aria-label={props.ariaLabel} aria-modal="true">
        <button type="button" class={`${buttonBase} mb-5 w-full bg-trauma-accent text-trauma-accent-ink hover:bg-trauma-accent-hover`} onClick={props.onClose}>
          Close
        </button>
        {props.children}
      </div>
    </div>
  );
}

function readStoredBrightness(): BrightnessMode {
  const value = localStorage.getItem(BRIGHTNESS_STORAGE_KEY);
  return value === "sun" || value === "night" ? value : DEFAULT_BRIGHTNESS_MODE;
}

function readStoredSurface(): SurfaceMode {
  const value = localStorage.getItem(SURFACE_STORAGE_KEY);
  return value === "normal" || value === "paper" ? value : DEFAULT_SURFACE_MODE;
}
