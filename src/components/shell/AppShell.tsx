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
import { TaxonomyCreatePopover } from "../memories/TaxonomyCreatePopover";
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
import {
  getBrowseMemories,
  getBrowseTaxonomy,
  revalidateBrowseTaxonomy,
} from "../memories/browse-loader";
import {
  buildBrowseHref,
  getBrowseSearchFieldValues,
  getRecentFlashbacks,
  parseBrowseQuery,
  toggleBrowseSearchFieldFilter,
  type BrowseSearchField,
  type BrowseFlashback,
  type BrowseQuery,
  type BrowseTaxonomySummaryItem,
} from "../memories/browse-data";
import { buildMemoryAnchorHref } from "../memories/memory-anchor-hrefs";
import { FlashbackShortcutList } from "../flashbacks/FlashbackShortcutList";
import {
  DEFAULT_BRIGHTNESS_MODE,
  DEFAULT_SURFACE_MODE,
  themeNameFromPreference,
  themeFromPreference,
  type BrightnessMode,
  type SurfaceMode,
} from "./theme";
import { RightRailContentContext } from "./right-rail-context";
import { ButtonHint } from "../ui/ButtonHint";
import { SegmentedToggleButton } from "../ui/SegmentedToggleButton";
import { WaxSealButton, WaxSealLabel } from "../ui/WaxSealButton";
import { TaxonomyList } from "../taxonomy/TaxonomyList";
import { Popup } from "../ui/Popup";

interface RouteNavItem {
  href: string;
  icon: keyof typeof TraumaNavIcons;
  label: string;
  pip: boolean;
}

interface AppShellProps {
  children: JSX.Element;
}

const buttonBase =
  "inline-flex min-h-[38px] items-center justify-center rounded-lg border border-trauma-border-strong px-3 py-2 font-bold";
const surfaceInput =
  "min-h-[42px] min-w-0 rounded-lg border border-trauma-border-strong bg-trauma-bg-surface px-3 text-trauma-text-primary placeholder:text-trauma-text-placeholder";
const sideSurface =
  "trauma-shell-left-rail sticky top-0 z-40 h-[100svh] overflow-visible bg-trauma-bg-base max-[720px]:hidden";
const rightRailSurface =
  "trauma-shell-right-rail sticky top-0 h-[100svh] overflow-hidden bg-trauma-bg-base px-6 py-4 max-[1040px]:hidden";
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
  "w-[252px] max-w-[calc(100vw-2rem)] max-[1040px]:left-full max-[1040px]:top-0 max-[1040px]:ml-2 max-[1040px]:mt-0";
const phoneTabButton =
  "trauma-capability-touch-target grid min-h-[52px] min-w-[4.75rem] shrink-0 place-items-center gap-0.5 rounded-2xl px-1 py-1 text-[11px] font-bold leading-tight text-trauma-text-secondary transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary aria-pressed:text-trauma-text-primary";
const railAddMemoryButton =
  "min-[1041px]:inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-trauma-accent px-4 py-2.5 text-[17px] font-extrabold text-trauma-accent-ink transition hover:bg-trauma-accent-hover max-[1040px]:hidden";
const compactAddMemoryButton =
  "min-[1041px]:hidden max-[1040px]:grid max-[1040px]:size-[52px] place-items-center rounded-full bg-trauma-accent text-trauma-accent-ink transition hover:bg-trauma-accent-hover aria-pressed:bg-trauma-accent-hover";
const BRIGHTNESS_STORAGE_KEY = "trauma:brightness";
const SURFACE_STORAGE_KEY = "trauma:surface";

const routeNavItems = [
  { href: "/memories", icon: "memories", label: "Memories", pip: false },
  { href: "/flashbacks", icon: "flashbacks", label: "Flashbacks", pip: true },
  { href: "/moments", icon: "moment", label: "Moments", pip: false },
] as const satisfies readonly RouteNavItem[];

const settingsNavItem = {
  href: "/settings",
  icon: "settings",
  label: "Settings",
  pip: false,
} as const satisfies RouteNavItem;

const desktopFilterShortcutItems = [
  { icon: "categories", label: "Categories" },
  { icon: "tags", label: "Tags" },
] as const;

const futureNavItems = {
  backup: { icon: "backup", label: "Backup" },
} as const;

const phoneTabItems = [
  { kind: "route", href: "/memories", icon: "memories", label: "Memories" },
  { kind: "route", href: "/flashbacks", icon: "flashbacks", label: "Flashbacks" },
  { kind: "route", href: "/moments", icon: "moment", label: "Moments" },
  { kind: "disabled", icon: "categories", label: "Categories" },
  { kind: "disabled", icon: "tags", label: "Tags" },
  { kind: "disabled", icon: "backup", label: "Backup" },
  { kind: "composer", icon: "add", label: "Add memory" },
  { kind: "theme", icon: "theme", label: "Theme" },
  { kind: "route", href: "/settings", icon: "settings", label: "Settings" },
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
  const taxonomy = createAsync(() => getBrowseTaxonomy());
  const backupFailsafeAlert = createAsync(() => getBackupFailsafeAlert());
  const browseMemories = createMemo(() => memories() ?? []);
  const query = createMemo(() => parseBrowseQuery(location.search));
  const categories = createMemo(() => taxonomy()?.categories ?? []);
  const tags = createMemo(() => taxonomy()?.tags ?? []);
  const flashbacks = createMemo(() => getRecentFlashbacks(browseMemories()));
  const activePath = createMemo(() => location.pathname);
  const activeCategoryIds = createMemo(() =>
    getActiveTaxonomyIds({
      explicitId: query().category,
      field: "category",
      items: categories(),
      search: query().q,
    }),
  );
  const activeTagIds = createMemo(() =>
    getActiveTaxonomyIds({
      explicitId: query().tag,
      field: "tag",
      items: tags(),
      search: query().q,
    }),
  );

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
    writeLocalStorageItem(BRIGHTNESS_STORAGE_KEY, nextBrightness);
    writeLocalStorageItem(SURFACE_STORAGE_KEY, nextSurface);
  });

  const goToFilter = (patch: Parameters<typeof buildBrowseHref>[1]) => {
    navigate(buildBrowseHref(query(), patch));
  };

  const toggleSearchFieldFilter = (input: {
    field: Extract<BrowseSearchField, "category" | "tag">;
    value: string;
  }) => {
    goToFilter({
      [input.field]: "",
      q: toggleBrowseSearchFieldFilter(query().q, input),
    });
  };

  return (
    <RightRailContentContext.Provider
      value={{ rightRailContent, setRightRailContent }}
    >
      <div class="trauma-shell-frame trauma-mobile-stable-viewport grid justify-center bg-trauma-bg-base text-trauma-text-primary min-[1041px]:grid-cols-[275px_minmax(0,840px)_360px] max-[1040px]:grid-cols-[80px_minmax(0,1fr)] max-[720px]:block">
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
            activeCategoryIds={activeCategoryIds()}
            activeFlashback={query().flashback}
            activeTag={query().tag}
            activeTagIds={activeTagIds()}
            categories={categories()}
            flashbacks={flashbacks()}
            idPrefix="desktop"
            onCreatedCategory={() => void revalidateBrowseTaxonomy()}
            onCreatedTag={() => void revalidateBrowseTaxonomy()}
            onSelectCategory={(category) =>
              toggleSearchFieldFilter({
                field: "category",
                value: category.name,
              })
            }
            onSelectTag={(tag) =>
              toggleSearchFieldFilter({
                field: "tag",
                value: tag.name,
              })
            }
            showFlashbacks={
              rightRailContent() === undefined &&
              !activePath().startsWith("/flashbacks")
            }
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

function getActiveTaxonomyIds(input: {
  explicitId: string;
  field: Extract<BrowseSearchField, "category" | "tag">;
  items: readonly BrowseTaxonomySummaryItem[];
  search: string;
}): string[] {
  const activeNames = new Set(
    getBrowseSearchFieldValues(input.search, input.field).map((value) =>
      normalizeTaxonomyFilterValue(value),
    ),
  );
  const ids = input.items
    .filter((item) => activeNames.has(normalizeTaxonomyFilterValue(item.name)))
    .map((item) => item.id);

  return input.explicitId.length > 0 && !ids.includes(input.explicitId)
    ? [input.explicitId, ...ids]
    : ids;
}

function normalizeTaxonomyFilterValue(value: string): string {
  return value.trim().toLocaleLowerCase();
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
      <span class={phoneIconSlot}>{icon()()}</span>
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
      <span class={phoneIconSlot}>{icon()()}</span>
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
        <RouteNavLink
          activePath={props.activePath}
          item={settingsNavItem}
          onNavigate={props.onNavigate}
        />
      </nav>
      <AddMemoryComposerButton
        mode="rail"
        onCreated={props.onNavigate}
        popoverId="rail-add-memory-composer"
      />
      <button type="button" class="mt-auto grid min-h-[60px] grid-cols-[40px_minmax(0,1fr)_20px] items-center gap-2.5 rounded-full bg-transparent px-3 py-2.5 text-left text-trauma-text-primary transition hover:bg-trauma-bg-tint max-[1040px]:mx-auto max-[1040px]:size-12 max-[1040px]:grid-cols-1 max-[1040px]:justify-items-center max-[1040px]:px-0" aria-label="Local archive" data-trauma-hint="Local archive">
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
        <ButtonHint>Local archive</ButtonHint>
      </button>
    </div>
  );
}

function AddMemoryComposerButton(props: {
  mode: "phone" | "rail";
  onCreated?: () => void;
  popoverId: string;
}) {
  const isPhone = () => props.mode === "phone";

  return (
    <Popup
      class={
        isPhone()
          ? "relative min-w-[4.75rem] shrink-0"
          : "relative mx-1 my-3.5 w-[calc(100%-8px)] max-[1040px]:mx-auto max-[1040px]:my-3.5 max-[1040px]:w-[52px]"
      }
      id={props.popoverId}
      label="Add memory"
      mode="dialog"
      panelClass={isPhone() ? "" : "w-[min(320px,calc(100vw-2rem))]"}
      phonePanel={isPhone()}
      placement="bottom-start"
      trigger={({ open, triggerProps }) => (
        <>
          <Show
            when={isPhone()}
            fallback={
              <>
                <WaxSealButton
                  {...triggerProps}
                  aria-pressed={open}
                  class={railAddMemoryButton}
                  hint="Add memory"
                  type="button"
                  variant="command"
                >
                  <PlusIcon />
                  <WaxSealLabel>Add memory</WaxSealLabel>
                </WaxSealButton>
                <button
                  {...triggerProps}
                  aria-pressed={open}
                  class={compactAddMemoryButton}
                  data-trauma-hint="Add memory"
                  type="button"
                >
                  <PlusIcon size={28} />
                  <span class="sr-only">Add memory</span>
                  <ButtonHint>Add memory</ButtonHint>
                </button>
              </>
            }
          >
            <button
              {...triggerProps}
              aria-pressed={open}
              class={`${phoneTabButton} w-full`}
              data-trauma-hint="Add memory"
              type="button"
            >
              <span class={phoneIconSlot}>
                <PlusIcon size={28} />
              </span>
              <span class={phoneTabLabel} data-phone-tab-label>
                Add memory
              </span>
              <ButtonHint>Add memory</ButtonHint>
            </button>
          </Show>
        </>
      )}
    >
      {({ close }) => (
        <AddMemoryForm
          formClass="grid gap-3.5 p-2"
          inputClass={surfaceInput}
          buttonClass={`${composerSubmitButton} w-full bg-trauma-accent text-trauma-accent-ink hover:bg-trauma-accent-hover`}
          submitLabel="Save memory"
          title="Add memory"
          onCreated={() => {
            close();
            props.onCreated?.();
          }}
        />
      )}
    </Popup>
  );
}

export function RightRailFilters(props: {
  activeCategory: string;
  activeCategoryIds?: readonly string[];
  activeFlashback: string;
  activeTag: string;
  activeTagIds?: readonly string[];
  categories: BrowseTaxonomySummaryItem[];
  flashbacks: BrowseFlashback[];
  idPrefix: string;
  onCreatedCategory: () => void;
  onCreatedTag: () => void;
  onSelectCategory: (category: BrowseTaxonomySummaryItem) => void;
  onSelectTag: (tag: BrowseTaxonomySummaryItem) => void;
  showFlashbacks?: boolean;
  tags: BrowseTaxonomySummaryItem[];
}) {
  const [openCreateKind, setOpenCreateKind] = createSignal<
    "category" | "tag" | undefined
  >();
  const toggleCreateKind = (kind: "category" | "tag") => {
    setOpenCreateKind((current) => (current === kind ? undefined : kind));
  };
  const closeCreatePopover = () => setOpenCreateKind(undefined);
  const createAndRevalidate = async (
    kind: "category" | "tag",
    name: string,
  ) => {
    await createTaxonomyRecord({ kind, name });
    if (kind === "category") {
      props.onCreatedCategory();
      return;
    }

    props.onCreatedTag();
  };

  return (
    <div class="grid gap-4">
      <RightPanelSection
        action={
          <TaxonomyCreateAction
            expanded={openCreateKind() === "category"}
            label="New category"
            onClick={() => toggleCreateKind("category")}
          />
        }
        title="Categories"
        titleId={`${props.idPrefix}-category-filters-title`}
      >
        <div class="relative grid gap-2">
          <TaxonomyList
            activeId={props.activeCategory}
            activeIds={props.activeCategoryIds}
            density="compact"
            emptyLabel="No categories yet"
            items={props.categories}
            kind="category"
            mode="chips"
            onSelect={props.onSelectCategory}
          />
          <Show when={openCreateKind() === "category"}>
            <TaxonomyCreatePopover
              label="Category name"
              placeholder="Research"
              submitLabel="Create category"
              title="New category"
              onClose={closeCreatePopover}
              onSubmitName={(name) => createAndRevalidate("category", name)}
            />
          </Show>
        </div>
      </RightPanelSection>
      <RightPanelSection
        action={
          <TaxonomyCreateAction
            expanded={openCreateKind() === "tag"}
            label="New tag"
            onClick={() => toggleCreateKind("tag")}
          />
        }
        title="Tags"
        titleId={`${props.idPrefix}-tag-filters-title`}
      >
        <div class="relative grid gap-2">
          <TaxonomyList
            activeId={props.activeTag}
            activeIds={props.activeTagIds}
            density="compact"
            emptyLabel="No tags yet"
            items={props.tags}
            kind="tag"
            mode="chips"
            onSelect={props.onSelectTag}
          />
          <Show when={openCreateKind() === "tag"}>
            <TaxonomyCreatePopover
              label="Tag name"
              placeholder="sqlite"
              submitLabel="Create tag"
              title="New tag"
              onClose={closeCreatePopover}
              onSubmitName={(name) => createAndRevalidate("tag", name)}
            />
          </Show>
        </div>
      </RightPanelSection>
      <Show when={props.showFlashbacks !== false}>
        <RightPanelSection title="Flashbacks" titleId={`${props.idPrefix}-flashback-shortcuts-title`}>
          <FlashbackShortcutList
            class={`${rightRailScrollContent} grid gap-3`}
            emptyLabel="No flashbacks yet"
            flashbacks={props.flashbacks.map((flashback) => ({
              active: props.activeFlashback === flashback.id,
              href: buildMemoryAnchorHref({
                anchorId: flashback.id,
                memoryId: flashback.memoryId,
              }),
              id: flashback.id,
              prefix: flashback.prefix,
              suffix: flashback.suffix,
              text: flashback.text,
            }))}
          />
        </RightPanelSection>
      </Show>
    </div>
  );
}

function TaxonomyCreateAction(props: {
  expanded: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={props.expanded}
      class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-bold text-trauma-text-secondary transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary"
      data-trauma-hint={props.label}
      type="button"
      onClick={props.onClick}
    >
      <PlusIcon size={16} />
      <span>{props.label}</span>
      <ButtonHint>{props.label}</ButtonHint>
    </button>
  );
}

type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface CreateTaxonomyRecordInput {
  fetch?: FetchFunction;
  kind: "category" | "tag";
  name: string;
}

interface CreatedTaxonomyRecord {
  id: string;
  name: string;
}

export async function createTaxonomyRecord(
  input: CreateTaxonomyRecordInput,
): Promise<CreatedTaxonomyRecord> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch(
    input.kind === "category" ? "/api/categories" : "/api/tags",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: input.name }),
    },
  );

  if (!response.ok) {
    throw new Error(`failed to create ${input.kind}`);
  }

  const body = (await response.json()) as unknown;
  return readCreatedTaxonomyRecord(body, input.kind);
}

function readCreatedTaxonomyRecord(
  body: unknown,
  key: "category" | "tag",
): CreatedTaxonomyRecord {
  if (!isRecord(body)) {
    throw new Error("taxonomy response was malformed");
  }

  const item = body[key];
  if (
    isRecord(item) &&
    typeof item.id === "string" &&
    typeof item.name === "string"
  ) {
    return {
      id: item.id,
      name: item.name,
    };
  }

  throw new Error("taxonomy response was malformed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function RightPanelSection(props: {
  action?: JSX.Element;
  children: JSX.Element;
  title: string;
  titleId: string;
}) {
  return (
    <section
      aria-labelledby={props.titleId}
      class="rounded-[20px] border border-trauma-border bg-trauma-bg-base p-5"
    >
      <div class="mb-4 flex items-center justify-between gap-3">
        <h2 class="mb-0 text-[20px] font-extrabold" id={props.titleId}>
          {props.title}
        </h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function RouteNavLink(props: {
  activePath: string;
  item: RouteNavItem;
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
      <span class={railIconSlot}>{icon()()}</span>
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
      <span class={railIconSlot}>{icon()()}</span>
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
      <span class={railIconSlot}>{icon()()}</span>
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
  const isPhone = () => props.mode === "phone";

  return (
    <Popup
      class={isPhone() ? "relative min-w-[4.75rem] shrink-0" : railPopoverRoot}
      id={props.popoverId}
      label="Theme settings"
      mode="dialog"
      panelClass={railPopoverPanel}
      phonePanel={isPhone()}
      placement="bottom-start"
      trigger={({ open, triggerProps }) => {
        const Icon = TraumaNavIcons.theme[open ? "filled" : "outline"];
        return (
          <button
            {...triggerProps}
            aria-pressed={open}
            class={`${isPhone() ? `${phoneTabButton} w-full` : navItemBase} ${open ? activeNavItem : ""}`}
            data-trauma-hint="Theme settings"
            type="button"
          >
            <span class={isPhone() ? phoneIconSlot : railIconSlot}>{Icon()}</span>
            <Show
              when={isPhone()}
              fallback={
                <span
                  class="min-w-0 truncate max-[1040px]:sr-only"
                >
                  <span
                    class={`trauma-active-nav-label ${open ? "font-bold" : ""}`}
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
            <ButtonHint>Theme settings</ButtonHint>
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
    <section class="grid w-full gap-1.5 px-2 py-2.5" aria-label="Theme">
      <p class="text-[11px] font-bold uppercase text-trauma-text-muted">Theme</p>
      <div class="grid grid-cols-2 gap-1 rounded-full bg-trauma-bg-sunken p-1" role="group" aria-label="Brightness">
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
      <div class="grid grid-cols-2 gap-1 rounded-full bg-trauma-bg-sunken p-1" role="group" aria-label="Surface">
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

function getNormalSurfaceLabel(brightness: BrightnessMode): "Light" | "Midnight" {
  return themeNameFromPreference({ brightness, surface: "normal" }) === "midnight"
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
