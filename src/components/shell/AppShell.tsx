import { A, createAsync, useLocation, useNavigate } from "@solidjs/router";
import { For, Show, createMemo, createSignal, type JSX } from "solid-js";

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
    <div class="app-shell">
      <MobileTopBar
        onOpenNavigation={() => setIsNavigationOpen(true)}
        onOpenFilters={() => setIsFiltersOpen(true)}
      />
      <aside class="left-nav" aria-label="Primary navigation">
        <NavigationContent onOpenComposer={openComposer} />
      </aside>
      <main class="content-shell">
        {props.children}
      </main>
      <aside class="right-panel" aria-label="Browse filters">
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
          <NavigationContent onNavigate={closeNavigation} onOpenComposer={openComposer} />
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
          <GlobalAddMemoryComposer />
        </Drawer>
      </Show>
    </div>
  );
}

function MobileTopBar(props: { onOpenNavigation: () => void; onOpenFilters: () => void }) {
  return (
    <header class="mobile-topbar">
      <button type="button" class="icon-button" aria-label="Open navigation" onClick={props.onOpenNavigation}>
        Menu
      </button>
      <A class="mobile-brand" href="/memories">
        Trauma
      </A>
      <button type="button" class="icon-button" aria-label="Open filters" onClick={props.onOpenFilters}>
        Filter
      </button>
    </header>
  );
}

function NavigationContent(props: { onNavigate?: () => void; onOpenComposer: () => void }) {
  return (
    <div class="navigation-content">
      <A class="brand" href="/memories" onClick={props.onNavigate}>
        Trauma
      </A>
      <nav class="nav-links">
        <A href="/memories" onClick={props.onNavigate}>
          Memories
        </A>
        <A href="/highlights" onClick={props.onNavigate}>
          Highlights
        </A>
      </nav>
      <button class="add-memory" type="button" onClick={props.onOpenComposer}>
        Add memory
      </button>
    </div>
  );
}

function GlobalAddMemoryComposer() {
  return (
    <form class="global-composer" aria-label="Add memory">
      <h2>Add memory</h2>
      <label>
        <span>URL</span>
        <input type="url" placeholder="https://example.com/article" />
      </label>
      <button type="button" disabled>
        Save memory
      </button>
    </form>
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
    <div class="filter-panel">
      <section class="filter-section" aria-labelledby={`${props.idPrefix}-category-filters-title`}>
        <h2 id={`${props.idPrefix}-category-filters-title`}>Categories</h2>
        <div class="filter-list">
          <For each={props.categories}>
            {(category) => (
              <button
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
        <h2 id={`${props.idPrefix}-tag-filters-title`}>Tags</h2>
        <div class="filter-list">
          <For each={props.tags}>
            {(tag) => (
              <button type="button" aria-pressed={props.activeTag === tag.id} onClick={() => props.onSelectTag(tag)}>
                {tag.name}
              </button>
            )}
          </For>
        </div>
      </section>
      <section class="filter-section" aria-labelledby={`${props.idPrefix}-highlight-shortcuts-title`}>
        <h2 id={`${props.idPrefix}-highlight-shortcuts-title`}>Recent highlights</h2>
        <div class="highlight-shortcuts">
          <For each={props.highlights}>
            {(highlight) => (
              <button
                type="button"
                aria-pressed={props.activeHighlight === highlight.id}
                onClick={() => props.onSelectHighlight(highlight)}
              >
                <span>{highlight.text}</span>
                <small>{highlight.prefix}</small>
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
    <div class="drawer-backdrop">
      <div class="drawer-panel" role="dialog" aria-label={props.ariaLabel} aria-modal="true">
        <button type="button" class="drawer-close" onClick={props.onClose}>
          Close
        </button>
        {props.children}
      </div>
    </div>
  );
}
