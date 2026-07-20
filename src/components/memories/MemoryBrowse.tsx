import { Title } from "@solidjs/meta";
import { createAsync, useLocation, useNavigate } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";

import {
  CollectionPageRetry,
  createCollectionPageRetryController,
  type CollectionPageRetryOutcome,
} from "../collections/CollectionPageRetry";
import type { AsyncActionFocusOwnership } from "../async-action-focus";
import {
  captureCollectionRowRemovalFocus,
} from "../collections/collection-row-removal-focus";
import { FlashbackExcerpt } from "../flashbacks/FlashbackExcerpt";
import {
  buildBrowseHref,
  createInitialBrowseMemoryPageRequest,
  createNextBrowseMemoryPageRequest,
  getBrowseReadStateFilter,
  getMemoryDisplayFlashback,
  isSameBrowseQuery,
  parseBrowseQuery,
  setBrowseReadStateFilter,
  type BrowseFlashback,
  type BrowseMemoryPage,
  type BrowseReadStateFilter,
  type BrowseMemory,
  type BrowseQuery,
  type BrowseTaxonomyItem,
  type BrowseTaxonomySummaryItem,
} from "./browse-data";
import { buildMemoryVariantAnchorHref } from "./memory-anchor-hrefs";
import {
  getBrowseMemoryPage,
  getBrowseTaxonomy,
  revalidateBrowseMemoryFirstPage,
  revalidateBrowseMemoryWorkspace,
} from "./browse-loader";
import { formatCapturedAtForDisplay } from "./captured-at";
import { MemoryActionMenu } from "./MemoryActionMenu";
import { MemoryReadStatusControl } from "./MemoryReadStatusControl";
import { MemorySearchBar } from "./MemorySearchBar";
import { TaxonomyAddControl } from "./TaxonomyAddControl";
import { TaxonomyList } from "../taxonomy/TaxonomyList";
import { ScrollableUrlLink } from "../url/ScrollableUrlText";
import {
  attachCategoryToMemoryByName,
  attachTagToMemoryByName,
  deleteMemoryById as deleteBrowseMemory,
  detachTagFromMemoryByName,
  isBackupFailsafeMemoryActionError,
} from "./memory-action-requests";
import {
  getBrowseFlashbacksForMemories,
  revalidateFlashbackBrowseRows,
} from "../flashbacks/flashbacks-loader";
import { revalidateMomentBrowseRows } from "../moments/moments-loader";
import { revalidateReaderMemory } from "../reader/reader-memory-loader";
import { revalidateBackupFailsafeAlert } from "../backup/backup-failsafe-loader";
export {
  attachCategoryToMemoryByName,
  attachTagToMemoryByName,
  deleteMemoryById as deleteBrowseMemory,
  detachTagFromMemoryByName,
  isBackupFailsafeMemoryActionError,
} from "./memory-action-requests";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const cardBase =
  "trauma-memory-card trauma-route-row grid min-w-0 grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-trauma-border px-6 py-[22px] transition hover:bg-trauma-bg-tint";
const cardTitle = "mb-0 text-xl font-bold leading-tight text-trauma-text-primary";
const subduedText = "mb-0 text-[13px] text-trauma-text-muted";
const readStateTabs = [
  { label: "All", value: "all" },
  { label: "Unread", value: "unread" },
  { label: "Read", value: "read" },
] as const satisfies readonly {
  label: string;
  value: BrowseReadStateFilter;
}[];

export async function settleCurrentBrowsePageRequest(input: {
  isCurrent: () => boolean;
  loadPage: () => Promise<BrowseMemoryPage>;
  onError: () => void;
  onPage: (page: BrowseMemoryPage) => void;
  onSettled: () => void;
}): Promise<void> {
  try {
    const page = await input.loadPage();
    if (input.isCurrent()) {
      input.onPage(page);
    }
  } catch {
    if (input.isCurrent()) {
      input.onError();
    }
  } finally {
    if (input.isCurrent()) {
      input.onSettled();
    }
  }
}

export type InitialBrowseMemoryPageState =
  | { page: BrowseMemoryPage; query: BrowseQuery; status: "ready" }
  | { query: BrowseQuery; status: "error" };

export async function settleInitialBrowseMemoryPage(
  query: BrowseQuery,
  loadPage: () => Promise<BrowseMemoryPage>,
): Promise<InitialBrowseMemoryPageState> {
  try {
    return { page: await loadPage(), query, status: "ready" };
  } catch {
    return { query, status: "error" };
  }
}

export function MemoryBrowse() {
  let pageRegionRef: HTMLDivElement | undefined;
  const location = useLocation();
  const navigate = useNavigate();
  const query = createMemo(() => parseBrowseQuery(location.search));
  const firstPageResult = createAsync(async () => {
    const requestedQuery = query();
    return settleInitialBrowseMemoryPage(requestedQuery, () =>
      getBrowseMemoryPage(
        createInitialBrowseMemoryPageRequest(requestedQuery),
      ),
    );
  });
  const taxonomy = createAsync(() => getBrowseTaxonomy());
  const availableCategories = createMemo(() => taxonomy()?.categories ?? []);
  const availableTags = createMemo(() => taxonomy()?.tags ?? []);
  const [additionalPages, setAdditionalPages] = createSignal<BrowseMemoryPage[]>([]);
  const [isLoadingNextPage, setIsLoadingNextPage] = createSignal(false);
  const [loadNextPageError, setLoadNextPageError] = createSignal("");
  let loadNextPageGeneration = 0;
  const invalidateLoadNextPage = (): void => {
    loadNextPageGeneration += 1;
    setIsLoadingNextPage(false);
    setLoadNextPageError("");
  };
  const [removedMemoryIds, setRemovedMemoryIds] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  const firstPageStateForCurrentQuery = createMemo(() => {
    const currentFirstPageResult = firstPageResult();
    if (
      currentFirstPageResult === undefined ||
      !isSameBrowseQuery(currentFirstPageResult.query, query())
    ) {
      return undefined;
    }

    return currentFirstPageResult;
  });
  const currentQueryKey = createMemo(() => buildBrowseHref(query(), {}));
  const firstPageRetry = createCollectionPageRetryController({
    getCurrentCursor: currentQueryKey,
    isPageReady: (requestedQueryKey) => {
      const state = firstPageStateForCurrentQuery();
      return state?.status === "ready" &&
        buildBrowseHref(state.query, {}) === requestedQueryKey;
    },
    revalidatePage: () => revalidateBrowseMemoryFirstPage(query()),
  });
  const firstPageForCurrentQuery = createMemo(() => {
    const state = firstPageStateForCurrentQuery();
    return state?.status === "ready" ? state.page : undefined;
  });
  const pages = createMemo(() => {
    const initialPage = firstPageForCurrentQuery();
    return initialPage === undefined ? [] : [initialPage, ...additionalPages()];
  });
  const nextCursor = createMemo(() => {
    const loadedPages = pages();
    const lastPage = loadedPages[loadedPages.length - 1];
    return lastPage?.nextCursor ?? null;
  });
  const visibleMemories = createMemo(() =>
    pages()
      .flatMap((page) => page.memories)
      .filter((memory) => !removedMemoryIds().has(memory.id)),
  );
  const visibleMemoryIds = createMemo(() => visibleMemories().map((memory) => memory.id));
  const [flashbacksByMemoryId, setFlashbacksByMemoryId] =
    createSignal<Record<string, BrowseFlashback[]>>({});
  const [, setCurrentFirstPage] = createSignal<BrowseMemoryPage>();
  const flashbackRequestMemoryIds = createMemo(() => {
    const hydratedFlashbacks = flashbacksByMemoryId();
    return visibleMemoryIds().filter(
      (memoryId) => hydratedFlashbacks[memoryId] === undefined,
    );
  });
  const loadedFlashbacksByMemoryId = createAsync(async () => {
    const memoryIds = flashbackRequestMemoryIds();
    if (memoryIds.length === 0) {
      return {};
    }

    return getBrowseFlashbacksForMemories({
      memoryIds,
      selectedFlashbackId: query().flashback,
    });
  });
  const isGrid = createMemo(() => query().view === "grid");
  const readStateFilter = createMemo(() => getBrowseReadStateFilter(query().q));
  const [isClientReady, setIsClientReady] = createSignal(false);
  const [selectedMemoryId, setSelectedMemoryId] = createSignal<string | null>(
    null,
  );
  const memoryLinkRefs = new Map<string, HTMLAnchorElement>();
  const [loadMoreSentinel, setLoadMoreSentinel] =
    createSignal<HTMLDivElement>();
  let searchInput: HTMLInputElement | undefined;
  const selectedMemoryIndex = createMemo(() => {
    const selectedId = selectedMemoryId();
    if (selectedId === null) {
      return -1;
    }

    return visibleMemories().findIndex((memory) => memory.id === selectedId);
  });
  const selectedMemory = createMemo(() => {
    const index = selectedMemoryIndex();
    return index >= 0 ? visibleMemories()[index] : undefined;
  });
  createEffect(() => {
    const visibleMemoryIdSet = new Set(visibleMemories().map((memory) => memory.id));
    for (const memoryId of memoryLinkRefs.keys()) {
      if (!visibleMemoryIdSet.has(memoryId)) {
        memoryLinkRefs.delete(memoryId);
      }
    }
  });
  createEffect(() => {
    const nextFirstPage = firstPageForCurrentQuery();
    if (nextFirstPage === undefined) {
      return;
    }

    setCurrentFirstPage((previousFirstPage) => {
      if (previousFirstPage !== undefined && previousFirstPage !== nextFirstPage) {
        invalidateLoadNextPage();
        setAdditionalPages([]);
        setFlashbacksByMemoryId({});
      }

      return nextFirstPage;
    });
  });

  const updateQuery = (patch: Parameters<typeof buildBrowseHref>[1], options: { replace?: boolean } = {}) => {
    navigate(buildBrowseHref(query(), patch), { replace: options.replace });
  };
  const updateReadStateFilter = (readState: BrowseReadStateFilter): void => {
    updateQuery({ q: setBrowseReadStateFilter(query().q, readState) });
  };
  const focusSearchInput = (): void => {
    searchInput?.focus();
    const cursorPosition = searchInput?.value.length ?? 0;
    searchInput?.setSelectionRange(cursorPosition, cursorPosition);
  };
  const setSelectedMemory = (memory: BrowseMemory): void => {
    setSelectedMemoryId(memory.id);
    requestAnimationFrame(() => {
      const link = memoryLinkRefs.get(memory.id);
      link?.closest("article")?.scrollIntoView({ block: "nearest" });
    });
  };
  const selectMemoryAt = (index: number): void => {
    const memories = visibleMemories();
    if (memories.length === 0) {
      setSelectedMemoryId(null);
      return;
    }

    const clampedIndex = Math.min(Math.max(index, 0), memories.length - 1);
    const memory = memories[clampedIndex];
    if (memory !== undefined) {
      setSelectedMemory(memory);
    }
  };
  const moveSelectedMemory = (delta: -1 | 1): void => {
    const currentIndex = selectedMemoryIndex();
    selectMemoryAt(currentIndex === -1 ? 0 : currentIndex + delta);
  };
  const openSelectedMemory = (): void => {
    const memory = selectedMemory();
    if (memory === undefined) {
      return;
    }

    const selectedFlashbackId = query().flashback;
    const flashbacks = flashbacksByMemoryId()[memory.id];
    if (selectedFlashbackId.length > 0 && flashbacks === undefined) {
      return;
    }

    navigate(buildMemoryBrowseItemHref(memory, selectedFlashbackId, flashbacks));
  };
  const loadNextPage = async (): Promise<void> => {
    if (isLoadingNextPage() || firstPageForCurrentQuery() === undefined) {
      return;
    }

    const cursor = nextCursor();
    if (cursor === null) {
      return;
    }

    const requestedQuery = query();
    const requestGeneration = ++loadNextPageGeneration;
    setIsLoadingNextPage(true);
    setLoadNextPageError("");
    await settleCurrentBrowsePageRequest({
      isCurrent: () =>
        requestGeneration === loadNextPageGeneration &&
        isSameBrowseQuery(query(), requestedQuery),
      loadPage: () =>
        getBrowseMemoryPage(
          createNextBrowseMemoryPageRequest(requestedQuery, cursor),
        ),
      onError: () => setLoadNextPageError("Failed to load more memories."),
      onPage: (page) => setAdditionalPages((current) => [...current, page]),
      onSettled: () => setIsLoadingNextPage(false),
    });
  };
  const clearAdditionalBrowsePages = (): void => {
    invalidateLoadNextPage();
    setAdditionalPages([]);
  };
  const observeLoadMoreSentinel = (): void => {
    const sentinel = loadMoreSentinel();
    if (sentinel === undefined || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadNextPage();
        }
      },
      { rootMargin: "480px" },
    );
    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  };

  createEffect(
    on(query, (nextQuery, previousQuery) => {
      if (previousQuery !== undefined && !isSameBrowseQuery(nextQuery, previousQuery)) {
        invalidateLoadNextPage();
        setAdditionalPages([]);
        setFlashbacksByMemoryId({});
        setRemovedMemoryIds(new Set<string>());
        setLoadNextPageError("");
      }
    }),
  );
  createEffect(() => {
    const loadedFlashbacks = loadedFlashbacksByMemoryId();
    if (
      loadedFlashbacks === undefined ||
      Object.keys(loadedFlashbacks).length === 0
    ) {
      return;
    }

    setFlashbacksByMemoryId((current) => ({
      ...current,
      ...loadedFlashbacks,
    }));
  });
  createEffect(() => observeLoadMoreSentinel());

  onMount(() => {
    setIsClientReady(true);
    const handleBrowseKeyDown = (event: KeyboardEvent): void => {
      if (isBrowseKeyboardSuppressed(event)) {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        focusSearchInput();
        return;
      }

      if (event.key === "j") {
        event.preventDefault();
        moveSelectedMemory(1);
        return;
      }

      if (event.key === "k") {
        event.preventDefault();
        moveSelectedMemory(-1);
        return;
      }

      if (event.key === "l" || event.key === "Enter") {
        if (isNativeActivationTarget(event.target)) {
          return;
        }
        event.preventDefault();
        openSelectedMemory();
      }
    };

    document.addEventListener("keydown", handleBrowseKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", handleBrowseKeyDown);
    });
  });

  return (
    <section class={pageFrame} aria-labelledby="memories-title">
      <Title>Memories | TRAUMA</Title>
      <header class="trauma-memory-browse-header sticky top-0 z-[2] border-b border-trauma-border bg-trauma-bg-surface/95 backdrop-blur">
        <h1 id="memories-title" class="sr-only">
          Memories
        </h1>
        <MemoryReadStateTabs
          value={readStateFilter()}
          onChange={updateReadStateFilter}
        />
      </header>
      <MemorySearchBar
        disabled={!isClientReady()}
        onSearchInputMount={(input) => {
          searchInput = input;
        }}
      />
      <div
        ref={pageRegionRef}
        aria-busy={
          firstPageStateForCurrentQuery() === undefined ||
          firstPageRetry.isRetryingCurrentPage()
        }
        aria-label="Memory page results"
        role="region"
        tabIndex={-1}
      >
        <Show
          when={
            firstPageStateForCurrentQuery() !== undefined ||
            firstPageRetry.isRetryingCurrentPage()
          }
          fallback={<MemoryBrowseState title="Loading memories..." />}
        >
          <Show
            when={
              !firstPageRetry.isRetryingCurrentPage() &&
              firstPageStateForCurrentQuery()?.status !== "error"
            }
            fallback={
              <MemoryBrowseInitialPageFailure
                getFocusTarget={() => pageRegionRef}
                onRetry={firstPageRetry.retryCurrentPage}
              />
            }
          >
            <Show
              when={visibleMemories().length > 0}
              fallback={
                <MemoryBrowseState
                  message="Adjust the search, category, tag, or flashback filter."
                  title="No matching memories"
                />
              }
            >
              <div class={isGrid() ? "trauma-memory-list memory-grid trauma-memory-grid grid grid-cols-2" : "trauma-memory-list grid"}>
                <For each={visibleMemories()}>
                  {(memory) => {
                    const memoryFlashbacks = createMemo(
                      () => flashbacksByMemoryId()[memory.id],
                    );

                    return (
                      <MemoryItem
                        memory={memory}
                        flashbacks={memoryFlashbacks() ?? []}
                        flashbacksHydrated={memoryFlashbacks() !== undefined}
                        availableCategories={availableCategories()}
                        availableTags={availableTags()}
                        selectedFlashbackId={query().flashback}
                        isKeyboardSelected={selectedMemoryId() === memory.id}
                        view={query().view}
                        getPageRegion={() => pageRegionRef}
                        onOpenLinkMount={(element) => {
                          memoryLinkRefs.set(memory.id, element);
                        }}
                        onDeleted={(memoryId) =>
                          setRemovedMemoryIds((current) => new Set([...current, memoryId]))
                        }
                        onMemoryMutated={clearAdditionalBrowsePages}
                      />
                    );
                  }}
                </For>
              </div>
            </Show>
            <Show when={nextCursor() !== null}>
              <div class="trauma-route-row grid gap-3 px-6 py-6 text-center">
                <button
                  class="justify-self-center rounded-full border border-trauma-border px-4 py-2 text-sm font-bold text-trauma-text-primary transition hover:bg-trauma-bg-tint disabled:cursor-wait disabled:opacity-60"
                  type="button"
                  disabled={isLoadingNextPage() || firstPageForCurrentQuery() === undefined}
                  onClick={() => void loadNextPage()}
                >
                  {isLoadingNextPage() ? "Loading..." : "Load more"}
                </button>
                <Show when={loadNextPageError() !== ""}>
                  <p class="mb-0 text-sm font-bold text-trauma-danger" role="alert">
                    {loadNextPageError()}
                  </p>
                </Show>
              </div>
            </Show>
            <div
              aria-hidden="true"
              class="h-px"
              ref={setLoadMoreSentinel}
            />
          </Show>
        </Show>
      </div>
    </section>
  );
}

function MemoryBrowseState(props: {
  children?: JSX.Element;
  message?: string;
  role?: "alert";
  title: string;
}) {
  return (
    <div
      class="trauma-route-row px-6 py-12 text-trauma-text-secondary"
      role={props.role}
    >
      <h2 class="text-xl font-bold text-trauma-text-primary">{props.title}</h2>
      <Show when={props.message}>{(message) => <p>{message()}</p>}</Show>
      {props.children}
    </div>
  );
}

export function MemoryBrowseInitialPageFailure(props: {
  getFocusTarget: () => HTMLElement | undefined;
  onRetry: () => CollectionPageRetryOutcome | Promise<CollectionPageRetryOutcome>;
}) {
  return (
    <MemoryBrowseState
      message="Retry the current memory search."
      role="alert"
      title="Failed to load memories"
    >
      <CollectionPageRetry
        getFocusTarget={props.getFocusTarget}
        onRetry={props.onRetry}
        subject="memories"
      />
    </MemoryBrowseState>
  );
}

function MemoryReadStateTabs(props: {
  value: BrowseReadStateFilter;
  onChange: (value: BrowseReadStateFilter) => void;
}) {
  const tabButtons: HTMLButtonElement[] = [];
  const focusTabButton = (index: number): void => {
    tabButtons[index]?.focus();
  };
  const scheduleFocusTabButton = (index: number): void => {
    window.requestAnimationFrame(() => focusTabButton(index));
  };
  const focusTab = (index: number): void => {
    const tab = readStateTabs[index];
    if (tab === undefined) {
      return;
    }

    props.onChange(tab.value);
    scheduleFocusTabButton(index);
  };
  const handleKeyDown = (event: KeyboardEvent, index: number): void => {
    const lastIndex = readStateTabs.length - 1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusTab(index === lastIndex ? 0 : index + 1);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusTab(index === 0 ? lastIndex : index - 1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusTab(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusTab(lastIndex);
    }
  };

  return (
    <div
      aria-label="Memory read status"
      class="trauma-memory-read-tabs"
      role="tablist"
    >
      <For each={readStateTabs}>
        {(tab, index) => {
          const active = createMemo(() => props.value === tab.value);

          return (
            <button
              aria-selected={active()}
              class="trauma-memory-read-tab"
              data-active={active() ? "true" : "false"}
              ref={(element) => {
                tabButtons[index()] = element;
              }}
              role="tab"
              tabIndex={active() ? 0 : -1}
              type="button"
              onKeyDown={(event) => handleKeyDown(event, index())}
              onClick={() => props.onChange(tab.value)}
            >
              {tab.label}
            </button>
          );
        }}
      </For>
    </div>
  );
}

export function MemoryItem(props: {
  availableCategories?: readonly BrowseTaxonomySummaryItem[];
  availableTags?: readonly BrowseTaxonomySummaryItem[];
  flashbacks?: readonly BrowseFlashback[];
  flashbacksHydrated?: boolean;
  isKeyboardSelected?: boolean;
  memory: BrowseMemory;
  selectedFlashbackId: string;
  view: "list" | "grid";
  getPageRegion?: () => HTMLElement | undefined;
  onDeleted?: (memoryId: string) => void;
  onMemoryMutated?: () => void;
  onOpenLinkMount?: (link: HTMLAnchorElement) => void;
}) {
  let rowRef: HTMLElement | undefined;
  const displayFlashback = createMemo(() =>
    getMemoryDisplayFlashback(
      props.memory,
      props.selectedFlashbackId,
      props.flashbacks,
    ),
  );
  const host = createMemo(() => getHostLabel(props.memory.url));
  const initial = createMemo(() => host().charAt(0).toLocaleUpperCase());
  const isSelected = createMemo(() => props.isKeyboardSelected === true);
  const [tags, setTags] = createSignal<BrowseTaxonomyItem[]>(props.memory.tags);
  const [categories, setCategories] = createSignal<BrowseTaxonomyItem[]>(
    props.memory.categories,
  );
  const [actionError, setActionError] = createSignal("");
  const isSelectedFlashbackHydrating = createMemo(() =>
    props.selectedFlashbackId.length > 0 &&
    props.flashbacksHydrated === false &&
    displayFlashback()?.id !== props.selectedFlashbackId,
  );
  const href = createMemo(() =>
    buildMemoryBrowseItemHref(props.memory, props.selectedFlashbackId, props.flashbacks),
  );

  const submitTag = async (name: string): Promise<void> => {
    setActionError("");
    try {
      const tag = await attachTagToMemoryByName({
        memoryId: props.memory.id,
        name,
      });
      setTags((current) => mergeTaxonomyItem(current, tag));
      props.onMemoryMutated?.();
      void revalidateAfterTaxonomyChange(props.memory.id);
    } catch (error) {
      setActionError("Failed to add tag.");
      throw error;
    }
  };

  const detachTag = async (name: string): Promise<void> => {
    setActionError("");
    try {
      const tag = await detachTagFromMemoryByName({
        memoryId: props.memory.id,
        name,
      });
      setTags((current) => current.filter((item) => item.id !== tag.id));
      props.onMemoryMutated?.();
      void revalidateAfterTaxonomyChange(props.memory.id);
    } catch (error) {
      setActionError("Failed to remove tag.");
      throw error;
    }
  };

  const submitCategory = async (input: {
    memoryId: string;
    name: string;
  }): Promise<void> => {
    setActionError("");
    try {
      const category = await attachCategoryToMemoryByName(input);
      setCategories((current) => mergeTaxonomyItem(current, category));
      props.onMemoryMutated?.();
      void revalidateAfterTaxonomyChange(input.memoryId);
    } catch (error) {
      setActionError("Failed to add category.");
      throw error;
    }
  };

  const deleteMemory = async (
    memoryId: string,
    focusOwnership: AsyncActionFocusOwnership,
  ): Promise<void> => {
    setActionError("");
    try {
      const pageRegion = props.getPageRegion?.();
      const restoreFocus = rowRef === undefined || pageRegion === undefined
        ? undefined
        : captureCollectionRowRemovalFocus({
            focusOwnership,
            pageRegion,
            row: rowRef,
          });
      await deleteBrowseMemory({ memoryId });
      props.onDeleted?.(memoryId);
      restoreFocus?.();
      props.onMemoryMutated?.();
      void revalidateAfterMemoryDeletion(memoryId).then(
        () => restoreFocus?.(),
        () => restoreFocus?.(),
      );
    } catch (error) {
      if (isBackupFailsafeMemoryActionError(error)) {
        void revalidateBackupFailsafeAlert();
      }
      setActionError("Failed to delete memory.");
      throw error;
    }
  };

  return (
    <article
      ref={rowRef}
      class={`${cardBase} relative cursor-pointer no-underline ${isSelected() ? "bg-trauma-bg-tint ring-1 ring-inset ring-trauma-border-strong" : ""} ${props.view === "grid" ? "min-h-[310px] border-r border-trauma-border" : ""}`}
      data-collection-row={props.memory.id}
      data-keyboard-selected={isSelected() ? "true" : "false"}
    >
      <a
        aria-label={`Open memory ${props.memory.title}`}
        aria-disabled={isSelectedFlashbackHydrating() ? "true" : undefined}
        class="absolute inset-0 z-0 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-trauma-accent"
        data-memory-row-link="true"
        data-collection-primary-link="true"
        href={isSelectedFlashbackHydrating() ? undefined : href()}
        ref={(element) => props.onOpenLinkMount?.(element)}
      />
      <span class="mt-1 grid size-12 place-items-center rounded-full border border-trauma-border bg-trauma-bg-elev text-lg font-extrabold text-trauma-accent" aria-hidden="true">
        {initial()}
      </span>
      <div class="grid min-w-0 gap-3">
        <header class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div class="min-w-0">
            <p class={subduedText}>
              <span class="font-bold text-trauma-text-primary">{host()}</span>
              <span class="px-1">.</span>
              <time dateTime={props.memory.capturedAt}>{formatCapturedAtForDisplay(props.memory.capturedAt)}</time>
            </p>
            <h2 class={cardTitle}>
              {props.memory.title}
            </h2>
          </div>
          <div class="relative z-10 flex items-start gap-2">
            <MemoryReadStatusControl
              memoryId={props.memory.id}
              initialRead={props.memory.read}
              variant="icon"
              onSaved={() => {
                props.onMemoryMutated?.();
                void revalidateAfterReadStatusChange(props.memory.id);
              }}
            />
            <MemoryActionMenu
              memoryId={props.memory.id}
              memoryTitle={props.memory.title}
              attachedCategories={categories()}
              categoryOptions={props.availableCategories ?? []}
              onDelete={deleteMemory}
              onAttachCategoryByName={submitCategory}
            />
          </div>
        </header>
        <p class="mb-0 leading-relaxed text-trauma-text-secondary">{props.memory.description}</p>
        <ScrollableUrlLink
          class={`${subduedText} relative z-10 no-underline hover:text-trauma-accent`}
          href={props.memory.url}
          rel="noreferrer"
          target="_blank"
          url={props.memory.url}
        />
        <Show when={displayFlashback()}>
          {(flashback) => (
            <FlashbackExcerpt
              prefix={flashback().prefix}
              suffix={flashback().suffix}
              text={flashback().text}
            />
          )}
        </Show>
        <footer class="grid gap-3">
          <div class="trauma-local-wrap" aria-label={`${props.memory.title} filters`}>
            <TaxonomyList
              class="contents"
              items={categories()}
              kind="category"
              mode="chips"
            />
            <TaxonomyList
              class="contents"
              items={tags()}
              kind="tag"
              mode="chips"
            />
            <Show when={props.memory.extractionStatus === "link_only"}>
              <span class="inline-flex items-center gap-1 rounded-full bg-trauma-accent-soft px-2.5 py-1 text-xs font-bold text-trauma-accent-soft-ink">
                <span aria-hidden="true">!</span>
                Link-only
              </span>
            </Show>
            <div class="relative z-10 inline-grid">
              <TaxonomyAddControl
                attachedItems={tags()}
                id={`memory-${props.memory.id}-tags-add`}
                kind="tag"
                options={props.availableTags ?? []}
                onAttachName={submitTag}
                onDetachName={detachTag}
                onError={(message) => setActionError(message)}
              />
            </div>
          </div>
          <Show when={actionError() !== ""}>
            <p class="mb-0 text-xs font-bold text-trauma-danger" role="alert">
              {actionError()}
            </p>
          </Show>
        </footer>
      </div>
    </article>
  );
}

async function revalidateAfterReadStatusChange(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateReaderMemory(memoryId),
  ]);
}

async function revalidateAfterTaxonomyChange(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateReaderMemory(memoryId),
  ]);
}

async function revalidateAfterMemoryDeletion(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateFlashbackBrowseRows(),
    revalidateMomentBrowseRows(),
    revalidateReaderMemory(memoryId),
  ]);
}

function getHostLabel(value: string): string {
  try {
    return new URL(value).host.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function mergeTaxonomyItem(
  current: BrowseTaxonomyItem[],
  next: BrowseTaxonomyItem,
): BrowseTaxonomyItem[] {
  if (current.some((item) => item.id === next.id)) {
    return current;
  }
  return [...current, next];
}

function buildMemoryBrowseItemHref(
  memory: BrowseMemory,
  selectedFlashbackId: string,
  flashbacks: readonly BrowseFlashback[] | undefined,
): string {
  const displayFlashback = getMemoryDisplayFlashback(
    memory,
    selectedFlashbackId,
    flashbacks,
  );
  const hasSelectedFlashback =
    selectedFlashbackId.length > 0 &&
    displayFlashback?.id === selectedFlashbackId;

  return buildMemoryVariantAnchorHref({
    anchorId: hasSelectedFlashback ? selectedFlashbackId : null,
    langCode: hasSelectedFlashback ? displayFlashback.langCode : null,
    memoryId: memory.id,
  });
}

function isBrowseKeyboardSuppressed(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
    return true;
  }

  if (
    isTextEntryTarget(event.target) ||
    isTextEntryTarget(document.activeElement)
  ) {
    return true;
  }

  if (document.querySelector('[role="dialog"], [role="menu"]') !== null) {
    return true;
  }

  return false;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target.matches("input, textarea, select");
}

function isNativeActivationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return target.closest("a,button,[role='button']") !== null;
}
