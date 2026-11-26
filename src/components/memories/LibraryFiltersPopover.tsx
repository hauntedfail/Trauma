import { For, Show, createMemo } from "solid-js";

import { Popup } from "../ui/Popup";
import type {
  BrowseQuery,
  BrowseSort,
  BrowseTaxonomySummaryItem,
  BrowseView,
} from "./browse-data";
import { hasBrowseInArchiveFilter } from "./browse-data";

export interface LibraryFilterFlashbackOption {
  id: string;
  text: string;
  memoryTitle?: string;
}

export interface LibraryFiltersPopoverProps {
  query: BrowseQuery;
  categories: readonly BrowseTaxonomySummaryItem[];
  tags: readonly BrowseTaxonomySummaryItem[];
  flashbacks: readonly LibraryFilterFlashbackOption[];
  disabled?: boolean;
  onSelectCategory: (categoryId: string) => void;
  onSelectTag: (tagId: string) => void;
  onSelectFlashback: (flashbackId: string) => void;
  onToggleArchive: (includeArchive: boolean) => void;
  onSelectSort: (sort: BrowseSort) => void;
  onSelectView: (view: BrowseView) => void;
  onClearFilters: () => void;
}

const sectionHeadingClass =
  "mb-1.5 text-[11px] font-bold uppercase tracking-wide text-trauma-text-muted";
const chipButtonBase =
  "inline-flex min-h-[30px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent";
const chipInactiveClass =
  "border-trauma-border bg-trauma-bg-surface text-trauma-text-secondary hover:border-trauma-border-strong hover:text-trauma-text-primary";
const chipActiveClass =
  "border-trauma-accent bg-trauma-accent-soft text-trauma-accent-soft-ink font-semibold";

export function LibraryFiltersPopover(props: LibraryFiltersPopoverProps) {
  const inArchive = createMemo(() => hasBrowseInArchiveFilter(props.query.q));
  const activeSort = createMemo<BrowseSort>(
    () => props.query.sort ?? "recent",
  );
  const hasActiveFilters = createMemo(
    () =>
      props.query.category !== "" ||
      props.query.tag !== "" ||
      props.query.flashback !== "" ||
      inArchive() ||
      activeSort() === "last_opened",
  );

  return (
    <Popup
      disabled={props.disabled}
      id="library-filters-popover"
      label="Library filters"
      mode="dialog"
      panelClass="w-[min(340px,calc(100vw-2rem))] max-h-[min(70vh,28rem)] overflow-y-auto bg-trauma-bg-surface/95 p-4"
      placement="bottom-end"
      trigger={({ triggerProps }) => (
        <button
          {...triggerProps}
          class="trauma-control trauma-control-tall shrink-0"
          data-library-filters-trigger="true"
          type="button"
        >
          <span>Filters</span>
          <Show when={hasActiveFilters()}>
            <span
              aria-hidden="true"
              class="size-2 rounded-full bg-trauma-accent"
            />
          </Show>
        </button>
      )}
    >
      {({ close }) => (
        <div class="grid gap-4" data-library-filters-panel="true">
          <div class="flex items-center justify-between gap-2">
            <h2 class="mb-0 text-sm font-semibold text-trauma-text-primary">
              Filters
            </h2>
            <Show when={hasActiveFilters()}>
              <button
                class="text-xs font-semibold text-trauma-text-muted underline-offset-2 hover:text-trauma-text-primary hover:underline"
                type="button"
                onClick={() => {
                  props.onClearFilters();
                  close();
                }}
              >
                Clear all
              </button>
            </Show>
          </div>

          <section aria-label="Sort">
            <p class={sectionHeadingClass}>Sort</p>
            <div class="flex flex-wrap gap-1.5" role="group" aria-label="Sort order">
              <button
                aria-pressed={activeSort() === "recent"}
                class={`${chipButtonBase} ${
                  activeSort() === "recent" ? chipActiveClass : chipInactiveClass
                }`}
                type="button"
                onClick={() => props.onSelectSort("recent")}
              >
                Recent
              </button>
              <button
                aria-pressed={activeSort() === "last_opened"}
                class={`${chipButtonBase} ${
                  activeSort() === "last_opened"
                    ? chipActiveClass
                    : chipInactiveClass
                }`}
                type="button"
                onClick={() => props.onSelectSort("last_opened")}
              >
                Last opened
              </button>
            </div>
          </section>

          <section aria-label="Archive">
            <p class={sectionHeadingClass}>Archive</p>
            <button
              aria-pressed={inArchive()}
              class={`${chipButtonBase} ${
                inArchive() ? chipActiveClass : chipInactiveClass
              }`}
              data-filter-in-archive="true"
              type="button"
              onClick={() => props.onToggleArchive(!inArchive())}
            >
              <span>in:archive</span>
            </button>
          </section>

          <section aria-label="Layout">
            <p class={sectionHeadingClass}>Layout</p>
            <div class="flex flex-wrap gap-1.5" role="group" aria-label="Layout view">
              <button
                aria-pressed={props.query.view === "list"}
                class={`${chipButtonBase} ${
                  props.query.view === "list" ? chipActiveClass : chipInactiveClass
                }`}
                type="button"
                onClick={() => props.onSelectView("list")}
              >
                List
              </button>
              <button
                aria-pressed={props.query.view === "grid"}
                class={`${chipButtonBase} ${
                  props.query.view === "grid" ? chipActiveClass : chipInactiveClass
                }`}
                type="button"
                onClick={() => props.onSelectView("grid")}
              >
                Grid
              </button>
            </div>
          </section>

          <Show when={props.categories.length > 0}>
            <section aria-label="Categories">
              <p class={sectionHeadingClass}>Categories</p>
              <div class="flex flex-wrap gap-1.5">
                <For each={props.categories}>
                  {(category) => {
                    const active = () => props.query.category === category.id;
                    return (
                      <button
                        aria-pressed={active()}
                        class={`${chipButtonBase} ${
                          active() ? chipActiveClass : chipInactiveClass
                        }`}
                        data-filter-category={category.id}
                        type="button"
                        onClick={() =>
                          props.onSelectCategory(active() ? "" : category.id)
                        }
                      >
                        <span>{category.name}</span>
                        <span
                          class="text-[11px] opacity-75"
                          data-taxonomy-count={category.memoryCount}
                        >
                          {category.memoryCount}
                        </span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </section>
          </Show>

          <Show when={props.tags.length > 0}>
            <section aria-label="Tags">
              <p class={sectionHeadingClass}>Tags</p>
              <div class="flex flex-wrap gap-1.5">
                <For each={props.tags}>
                  {(tag) => {
                    const active = () => props.query.tag === tag.id;
                    return (
                      <button
                        aria-pressed={active()}
                        class={`${chipButtonBase} ${
                          active() ? chipActiveClass : chipInactiveClass
                        }`}
                        data-filter-tag={tag.id}
                        type="button"
                        onClick={() => props.onSelectTag(active() ? "" : tag.id)}
                      >
                        <span>#{tag.name}</span>
                        <span
                          class="text-[11px] opacity-75"
                          data-taxonomy-count={tag.memoryCount}
                        >
                          {tag.memoryCount}
                        </span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </section>
          </Show>

          <Show when={props.flashbacks.length > 0 || props.query.flashback !== ""}>
            <section aria-label="Flashbacks">
              <p class={sectionHeadingClass}>Flashback</p>
              <div class="grid gap-1.5">
                <For each={props.flashbacks}>
                  {(flashback) => {
                    const active = () => props.query.flashback === flashback.id;
                    return (
                      <button
                        aria-pressed={active()}
                        class={`flex w-full items-center justify-between gap-2 rounded-control border px-2.5 py-1.5 text-left text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent ${
                          active() ? chipActiveClass : chipInactiveClass
                        }`}
                        data-filter-flashback={flashback.id}
                        type="button"
                        onClick={() =>
                          props.onSelectFlashback(active() ? "" : flashback.id)
                        }
                      >
                        <span class="truncate">“{flashback.text}”</span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </section>
          </Show>
        </div>
      )}
    </Popup>
  );
}
