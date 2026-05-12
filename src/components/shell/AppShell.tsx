import { A, createAsync, useLocation, useNavigate } from "@solidjs/router";
import { For, Show, createMemo, createSignal, type JSX } from "solid-js";

import { AddMemoryForm } from "../memories/AddMemoryForm";
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

interface AppShellProps {
  children: JSX.Element;
}

const buttonBase =
  "inline-flex min-h-[38px] items-center justify-center rounded-lg border border-[#b8c4b1] px-3 py-2 font-bold";
const surfaceInput =
  "min-h-[42px] min-w-0 rounded-lg border border-[#b8c4b1] bg-trauma-bg-surface px-3 text-trauma-text-primary";
const sideSurface =
  "sticky top-0 h-screen overflow-y-auto bg-trauma-bg-surface max-[720px]:hidden";

export function AppShell(props: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isNavigationOpen, setIsNavigationOpen] = createSignal(false);
  const [isFiltersOpen, setIsFiltersOpen] = createSignal(false);
  const [isComposerOpen, setIsComposerOpen] = createSignal(false);
  const memories = createAsync(() => getBrowseMemories());
  const browseMemories = createMemo(() => memories() ?? []);
  const query = createMemo(() => parseBrowseQuery(location.search));
  const categories = createMemo(() => getBrowseCategories(browseMemories()));
  const tags = createMemo(() => getBrowseTags(browseMemories()));
  const highlights = createMemo(() => getRecentHighlights(browseMemories()));

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

  return (
    <div class="grid min-h-screen grid-cols-[minmax(188px,248px)_minmax(0,1fr)_minmax(248px,328px)] bg-trauma-bg-base text-trauma-text-primary max-[1040px]:grid-cols-[80px_minmax(0,1fr)] max-[1040px]:grid-rows-[auto_1fr] max-[720px]:block">
      <MobileTopBar
        onOpenNavigation={() => setIsNavigationOpen(true)}
        onOpenFilters={() => setIsFiltersOpen(true)}
      />
      <aside class={`${sideSurface} border-r border-trauma-border p-6 max-[1040px]:row-span-2 max-[1040px]:p-4 max-[1040px]:px-2.5`} aria-label="Primary navigation">
        <NavigationContent onOpenComposer={openComposer} />
      </aside>
      <main class="min-w-0 max-[1040px]:col-start-2">
        {props.children}
      </main>
      <aside class={`${sideSurface} border-l border-trauma-border p-5 max-[1040px]:hidden`} aria-label="Browse filters">
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
      </aside>
      <Show when={isNavigationOpen()}>
        <Drawer ariaLabel="Navigation" onClose={() => setIsNavigationOpen(false)}>
          <NavigationContent isDrawer onNavigate={closeNavigation} onOpenComposer={openComposer} />
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
  );
}

function MobileTopBar(props: { onOpenNavigation: () => void; onOpenFilters: () => void }) {
  return (
    <header class="sticky top-0 z-10 col-start-2 hidden min-h-[58px] grid-cols-[minmax(0,1fr)_112px] items-center gap-2 border-b border-trauma-border bg-trauma-bg-surface px-3 py-2 max-[1040px]:grid max-[720px]:grid-cols-[96px_minmax(0,1fr)_96px]">
      <button type="button" class={`${buttonBase} hidden w-full overflow-hidden bg-white text-trauma-accent max-[720px]:inline-flex`} aria-label="Open navigation" onClick={props.onOpenNavigation}>
        Menu
      </button>
      <A class="inline-flex min-h-10 min-w-0 items-center text-[22px] font-extrabold max-[1040px]:text-xl max-[720px]:justify-center" href="/memories">
        TRAUMA
      </A>
      <button type="button" class={`${buttonBase} w-full overflow-hidden bg-white text-trauma-accent`} aria-label="Open filters" onClick={props.onOpenFilters}>
        Filter
      </button>
    </header>
  );
}

function NavigationContent(props: { isDrawer?: boolean; onNavigate?: () => void; onOpenComposer: () => void }) {
  return (
    <div
      class="grid grid-rows-[auto_1fr_auto] gap-7"
      classList={{
        "min-h-0": props.isDrawer === true,
        "min-h-[calc(100vh-48px)] max-[1040px]:min-h-[calc(100vh-32px)]": props.isDrawer !== true,
      }}
    >
      <A class="inline-flex min-h-10 items-center text-[22px] font-extrabold max-[1040px]:w-full max-[1040px]:justify-center max-[1040px]:text-lg" href="/memories" onClick={props.onNavigate}>
        TRAUMA
      </A>
      <nav class="grid content-start gap-2">
        <A class="min-h-10 rounded-lg px-3 py-2.5 font-bold text-[#263126] hover:bg-[#edf3e8] max-[1040px]:overflow-hidden max-[1040px]:px-2 max-[1040px]:text-center max-[1040px]:text-ellipsis" href="/memories" onClick={props.onNavigate}>
          Memories
        </A>
        <A class="min-h-10 rounded-lg px-3 py-2.5 font-bold text-[#263126] hover:bg-[#edf3e8] max-[1040px]:overflow-hidden max-[1040px]:px-2 max-[1040px]:text-center max-[1040px]:text-ellipsis" href="/highlights" onClick={props.onNavigate}>
          Highlights
        </A>
      </nav>
      <button class={`${buttonBase} w-full bg-trauma-accent text-white max-[1040px]:overflow-hidden max-[1040px]:px-2 max-[1040px]:text-center max-[1040px]:text-ellipsis`} type="button" onClick={props.onOpenComposer}>
        Add memory
      </button>
    </div>
  );
}

function GlobalAddMemoryComposer(props: { onCreated: () => void }) {
  return (
    <AddMemoryForm
      formClass="grid gap-3.5"
      inputClass={surfaceInput}
      buttonClass={`${buttonBase} bg-trauma-accent text-white`}
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
    <div class="grid gap-6">
      <section class="filter-section" aria-labelledby={`${props.idPrefix}-category-filters-title`}>
        <h2 class="mb-2.5 text-[15px] font-bold" id={`${props.idPrefix}-category-filters-title`}>Categories</h2>
        <div class="grid gap-2">
          <For each={props.categories}>
            {(category) => (
              <button
                class={`${buttonBase} w-full justify-start bg-white text-left text-[#263126] aria-pressed:bg-trauma-accent aria-pressed:text-white`}
                type="button"
                aria-pressed={props.activeCategory === category.id}
                onClick={() => props.onSelectCategory(category)}
              >
                {category.name}
              </button>
            )}
          </For>
        </div>
      </section>
      <section class="filter-section" aria-labelledby={`${props.idPrefix}-tag-filters-title`}>
        <h2 class="mb-2.5 text-[15px] font-bold" id={`${props.idPrefix}-tag-filters-title`}>Tags</h2>
        <div class="grid gap-2">
          <For each={props.tags}>
            {(tag) => (
              <button class={`${buttonBase} w-full justify-start bg-white text-left text-[#263126] aria-pressed:bg-trauma-accent aria-pressed:text-white`} type="button" aria-pressed={props.activeTag === tag.id} onClick={() => props.onSelectTag(tag)}>
                {tag.name}
              </button>
            )}
          </For>
        </div>
      </section>
      <section class="filter-section" aria-labelledby={`${props.idPrefix}-highlight-shortcuts-title`}>
        <h2 class="mb-2.5 text-[15px] font-bold" id={`${props.idPrefix}-highlight-shortcuts-title`}>Recent highlights</h2>
        <div class="grid gap-2">
          <For each={props.highlights}>
            {(highlight) => (
              <button
                class={`${buttonBase} grid min-h-[74px] w-full justify-stretch gap-1 bg-white text-left text-[#263126] aria-pressed:bg-trauma-accent aria-pressed:text-white`}
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
      </section>
    </div>
  );
}

function Drawer(props: { ariaLabel: string; children: JSX.Element; onClose: () => void }) {
  return (
    <div class="fixed inset-0 z-20 bg-gray-900/45">
      <div class="max-h-screen min-h-screen w-[min(86vw,340px)] overflow-y-auto bg-trauma-bg-surface p-[18px] shadow-[0_20px_60px_rgb(17_24_39_/_24%)]" role="dialog" aria-label={props.ariaLabel} aria-modal="true">
        <button type="button" class={`${buttonBase} mb-5 w-full bg-trauma-accent text-white`} onClick={props.onClose}>
          Close
        </button>
        {props.children}
      </div>
    </div>
  );
}
