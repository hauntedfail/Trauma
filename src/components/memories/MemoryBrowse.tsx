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
} from "solid-js";

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
  type BrowseTaxonomyItem,
  type BrowseTaxonomySummaryItem,
} from "./browse-data";
import { buildMemoryVariantAnchorHref } from "./memory-anchor-hrefs";
import {
  getBrowseMemoryPage,
  getBrowseTaxonomy,
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

export function MemoryBrowse() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = createMemo(() => parseBrowseQuery(location.search));
  const firstPage = createAsync(() =>
    getBrowseMemoryPage(createInitialBrowseMemoryPageRequest(query())),
  );
  const taxonomy = createAsync(() => getBrowseTaxonomy());
  const availableCategories = createMemo(() => taxonomy()?.categories ?? []);
  const availableTags = createMemo(() => taxonomy()?.tags ?? []);
  const [additionalPages, setAdditionalPages] = createSignal<BrowseMemoryPage[]>([]);
  const [isLoadingNextPage, setIsLoadingNextPage] = createSignal(false);
  const [loadNextPageError, setLoadNextPageError] = createSignal("");
  const [removedMemoryIds, setRemovedMemoryIds] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  const pages = createMemo(() => {
    const initialPage = firstPage();
    return initialPage === undefined
      ? additionalPages()
      : [initialPage, ...additionalPages()];
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
  const flashbacksByMemoryId = createAsync(async () => {
    const memoryIds = visibleMemoryIds();
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
  const [loadMoreSentinel, setLoadMoreSentinel] =
    createSignal<HTMLDivElement>();

  const updateQuery = (patch: Parameters<typeof buildBrowseHref>[1], options: { replace?: boolean } = {}) => {
    navigate(buildBrowseHref(query(), patch), { replace: options.replace });
  };
  const updateReadStateFilter = (readState: BrowseReadStateFilter): void => {
    updateQuery({ q: setBrowseReadStateFilter(query().q, readState) });
  };
  const loadNextPage = async (): Promise<void> => {
    const cursor = nextCursor();
    if (cursor === null || isLoadingNextPage()) {
      return;
    }

    const requestedQuery = query();
    setIsLoadingNextPage(true);
    setLoadNextPageError("");
    try {
      const page = await getBrowseMemoryPage(
        createNextBrowseMemoryPageRequest(requestedQuery, cursor),
      );
      if (!isSameBrowseQuery(query(), requestedQuery)) {
        return;
      }
      setAdditionalPages((current) => [...current, page]);
    } catch (error) {
      setLoadNextPageError("Failed to load more memories.");
      throw error;
    } finally {
      setIsLoadingNextPage(false);
    }
  };
  const clearAdditionalBrowsePages = (): void => {
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
        setAdditionalPages([]);
        setRemovedMemoryIds(new Set<string>());
        setLoadNextPageError("");
      }
    }),
  );
  createEffect(() => observeLoadMoreSentinel());

  onMount(() => setIsClientReady(true));

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
      <MemorySearchBar disabled={!isClientReady()} />
      <Show
        when={visibleMemories().length > 0}
        fallback={
          <div class="trauma-route-row px-6 py-12 text-trauma-text-secondary">
            <h2 class="text-xl font-bold text-trauma-text-primary">No matching memories</h2>
            <p>Adjust the search, category, tag, or flashback filter.</p>
          </div>
        }
      >
        <div class={isGrid() ? "trauma-memory-list memory-grid trauma-memory-grid grid grid-cols-2" : "trauma-memory-list grid"}>
          <For each={visibleMemories()}>
            {(memory) => (
              <MemoryItem
                memory={memory}
                flashbacks={flashbacksByMemoryId()?.[memory.id] ?? []}
                availableCategories={availableCategories()}
                availableTags={availableTags()}
                selectedFlashbackId={query().flashback}
                view={query().view}
                onOpen={(href) => navigate(href)}
                onDeleted={(memoryId) =>
                  setRemovedMemoryIds((current) => new Set([...current, memoryId]))
                }
                onMemoryMutated={clearAdditionalBrowsePages}
              />
            )}
          </For>
        </div>
        <Show when={nextCursor() !== null}>
          <div class="trauma-route-row grid gap-3 px-6 py-6 text-center">
            <button
              class="justify-self-center rounded-full border border-trauma-border px-4 py-2 text-sm font-bold text-trauma-text-primary transition hover:bg-trauma-bg-tint disabled:cursor-wait disabled:opacity-60"
              type="button"
              disabled={isLoadingNextPage()}
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
    </section>
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
  memory: BrowseMemory;
  selectedFlashbackId: string;
  view: "list" | "grid";
  onOpen?: (href: string) => void;
  onDeleted?: (memoryId: string) => void;
  onMemoryMutated?: () => void;
}) {
  const displayFlashback = createMemo(() =>
    getMemoryDisplayFlashback(
      props.memory,
      props.selectedFlashbackId,
      props.flashbacks,
    ),
  );
  const host = createMemo(() => getHostLabel(props.memory.url));
  const initial = createMemo(() => host().charAt(0).toLocaleUpperCase());
  const [tags, setTags] = createSignal<BrowseTaxonomyItem[]>(props.memory.tags);
  const [categories, setCategories] = createSignal<BrowseTaxonomyItem[]>(
    props.memory.categories,
  );
  const [actionError, setActionError] = createSignal("");
  const href = createMemo(() =>
    buildMemoryVariantAnchorHref({
      anchorId:
        props.selectedFlashbackId.length > 0 &&
        displayFlashback()?.id === props.selectedFlashbackId
          ? props.selectedFlashbackId
          : null,
      langCode:
        props.selectedFlashbackId.length > 0 &&
        displayFlashback()?.id === props.selectedFlashbackId
          ? displayFlashback()?.langCode
          : null,
      memoryId: props.memory.id,
    }),
  );

  const openMemory = (): void => {
    if (props.onOpen !== undefined) {
      props.onOpen(href());
      return;
    }

    if (typeof window !== "undefined") {
      window.location.href = href();
    }
  };

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

  const deleteMemory = async (memoryId: string): Promise<void> => {
    setActionError("");
    try {
      await deleteBrowseMemory({ memoryId });
      props.onDeleted?.(memoryId);
      props.onMemoryMutated?.();
      void revalidateAfterMemoryDeletion(memoryId);
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
      class={`${cardBase} cursor-pointer no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-trauma-accent ${props.view === "grid" ? "min-h-[310px] border-r border-trauma-border" : ""}`}
      onClick={(event) => {
        if (!isInteractiveTarget(event.target)) {
          openMemory();
        }
      }}
    >
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
              <a
                aria-label={`Open memory ${props.memory.title}`}
                class="text-trauma-text-primary no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trauma-accent"
                href={href()}
                onClick={(event) => event.stopPropagation()}
              >
                {props.memory.title}
              </a>
            </h2>
          </div>
          <div class="flex items-start gap-2">
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
          class={`${subduedText} no-underline hover:text-trauma-accent`}
          href={props.memory.url}
          rel="noreferrer"
          target="_blank"
          url={props.memory.url}
          onClick={(event) => event.stopPropagation()}
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
            <span class="relative inline-grid">
              <TaxonomyAddControl
                attachedItems={tags()}
                id={`memory-${props.memory.id}-tags-add`}
                kind="tag"
                options={props.availableTags ?? []}
                onAttachName={submitTag}
                onDetachName={detachTag}
                onError={(message) => setActionError(message)}
              />
            </span>
          </div>
          <Show when={actionError() !== ""}>
            <p class="mb-0 text-xs font-bold text-trauma-danger">{actionError()}</p>
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

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    ? target.closest("a,button,input,select,textarea,[role='menu']") !== null
    : false;
}
