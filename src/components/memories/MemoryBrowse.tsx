import { Title } from "@solidjs/meta";
import { A, createAsync, useLocation, useNavigate } from "@solidjs/router";
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
import { captureCollectionRowRemovalFocus } from "../collections/collection-row-removal-focus";
import { FlashbackExcerpt } from "../flashbacks/FlashbackExcerpt";
import {
  buildBrowseHref,
  createInitialBrowseMemoryPageRequest,
  createNextBrowseMemoryPageRequest,
  defaultBrowseQuery,
  formatResumptionCue,
  getLengthBucket,
  getMemoryDisplayFlashback,
  hasBrowseInArchiveFilter,
  isSameBrowseQuery,
  parseBrowseQuery,
  resolveBrowseLane,
  setBrowseInArchiveFilter,
  type BrowseFlashback,
  type BrowseLane,
  type BrowseMemory,
  type BrowseMemoryPage,
  type BrowseMemoryPageRequestOptions,
  type BrowseQuery,
  type BrowseSort,
  type BrowseTaxonomyItem,
  type BrowseTaxonomySummaryItem,
  type BrowseView,
  type MemoryTriageState,
  type ShelfExpiryAction,
} from "./browse-data";
import { buildMemoryVariantAnchorHref } from "./memory-anchor-hrefs";
import {
  getBrowseMemoryPage,
  getBrowseTaxonomy,
  revalidateBrowseMemoryFirstPage,
  revalidateBrowseMemoryPages,
  revalidateBrowseMemoryWorkspace,
} from "./browse-loader";
import {
  LibraryFiltersPopover,
  type LibraryFilterFlashbackOption,
} from "./LibraryFiltersPopover";
import { MemoryActionMenu } from "./MemoryActionMenu";
import { MemoryReadStatusControl } from "./MemoryReadStatusControl";
import { MemorySearchBar } from "./MemorySearchBar";
import { TaxonomyAddControl } from "./TaxonomyAddControl";
import { TaxonomyList } from "../taxonomy/TaxonomyList";
import {
  attachCategoryToMemoryByName,
  attachTagToMemoryByName,
  deleteMemoryById as deleteBrowseMemory,
  detachTagFromMemoryByName,
  isBackupFailsafeMemoryActionError,
  isTodayCapReachedError,
  setMemoryTriageState,
  TODAY_CAP_REACHED_MESSAGE,
} from "./memory-action-requests";
import {
  getBrowseFlashbacksForMemories,
  getRecentFlashbackBrowseRows,
  revalidateFlashbackBrowseRows,
} from "../flashbacks/flashbacks-loader";
import { revalidateMomentBrowseRows } from "../moments/moments-loader";
import { revalidateReaderMemory } from "../reader/reader-memory-loader";
import { revalidateBackupFailsafeAlert } from "../backup/backup-failsafe-loader";
import {
  EPHEMERAL_SHELF_TRIAGE_PLUGIN_ID,
  useFocusPlugins,
} from "../../plugins";

export {
  attachCategoryToMemoryByName,
  attachTagToMemoryByName,
  deleteMemoryById as deleteBrowseMemory,
  detachTagFromMemoryByName,
  isBackupFailsafeMemoryActionError,
  isTodayCapReachedError,
  setMemoryTriageState,
  TODAY_CAP_REACHED_MESSAGE,
} from "./memory-action-requests";

const UNDO_TOAST_DURATION_MS = 6_000;

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport trauma-browse-column mx-auto w-full max-w-[720px] bg-trauma-bg-surface";
const flatRowBase =
  "trauma-memory-row trauma-route-row relative grid min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-3 border-b border-trauma-border px-6 py-3.5 transition hover:bg-trauma-bg-tint focus-within:z-20 has-[[aria-expanded='true']]:z-30";
const rowActionButtonClass =
  "inline-flex min-h-[28px] items-center rounded-full border border-trauma-border bg-trauma-bg-surface px-2.5 py-0.5 text-xs font-medium text-trauma-text-secondary transition hover:border-trauma-border-strong hover:text-trauma-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent disabled:cursor-not-allowed disabled:opacity-45";

const LANE_TITLES: Record<BrowseLane, string> = {
  today: "Today",
  shelf: "Shelf",
  library: "Library",
};

interface UndoTriageEntry {
  memory: BrowseMemory;
  fromState: MemoryTriageState;
  toState: MemoryTriageState;
  label: string;
}

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
  const focusPlugins = useFocusPlugins();

  const rawQuery = createMemo(() => parseBrowseQuery(location.search));
  const activeLane = createMemo<BrowseLane>(() => resolveBrowseLane(rawQuery()));
  const query = createMemo<BrowseQuery>(() => ({
    ...rawQuery(),
    lane: activeLane(),
  }));

  const isEphemeralShelfEnabled = createMemo(() =>
    focusPlugins.isPluginEnabled(EPHEMERAL_SHELF_TRIAGE_PLUGIN_ID),
  );
  const dailyPickCap = createMemo(() => {
    const rawCap = focusPlugins.getPluginSetting<number>(
      EPHEMERAL_SHELF_TRIAGE_PLUGIN_ID,
      "dailyPickCap",
    );
    return typeof rawCap === "number" && Number.isFinite(rawCap) && rawCap > 0
      ? Math.trunc(rawCap)
      : 3;
  });
  const shelfTtlDays = createMemo<number | null>(() => {
    if (!isEphemeralShelfEnabled()) {
      return null;
    }
    const rawTtl = focusPlugins.getPluginSetting<string>(
      EPHEMERAL_SHELF_TRIAGE_PLUGIN_ID,
      "shelfTtlDays",
    );
    const parsed = Number(rawTtl);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 14;
  });
  const shelfExpiryAction = createMemo<ShelfExpiryAction>(() => {
    const rawAction = focusPlugins.getPluginSetting<string>(
      EPHEMERAL_SHELF_TRIAGE_PLUGIN_ID,
      "shelfExpiryAction",
    );
    return rawAction === "soft-archive" ? "soft-archive" : "mark";
  });
  const pageRequestOptions = createMemo<BrowseMemoryPageRequestOptions>(() =>
    activeLane() === "shelf" && isEphemeralShelfEnabled()
      ? {
          shelfTtlDays: shelfTtlDays(),
          shelfExpiryAction: shelfExpiryAction(),
        }
      : {},
  );

  const firstPageResult = createAsync(async () => {
    const requestedQuery = query();
    const options = pageRequestOptions();
    return settleInitialBrowseMemoryPage(requestedQuery, () =>
      getBrowseMemoryPage(
        createInitialBrowseMemoryPageRequest(requestedQuery, options),
      ),
    );
  });

  // When on Shelf with ephemeral-shelf-triage enabled, check Today's current items
  // so Pick can be disabled with neutral copy as soon as the cap is reached.
  const todayCapProbePage = createAsync(async () => {
    if (activeLane() !== "shelf" || !isEphemeralShelfEnabled()) {
      return undefined;
    }
    try {
      return await getBrowseMemoryPage({
        query: { ...defaultBrowseQuery, lane: "today" },
        cursor: null,
        limit: dailyPickCap(),
      });
    } catch {
      return undefined;
    }
  });

  const taxonomy = createAsync(() => getBrowseTaxonomy());
  const availableCategories = createMemo(() => taxonomy()?.categories ?? []);
  const availableTags = createMemo(() => taxonomy()?.tags ?? []);
  const recentFlashbacks = createAsync(async () => {
    if (activeLane() !== "library") {
      return [];
    }
    try {
      const rows = await getRecentFlashbackBrowseRows(5);
      return rows.map<LibraryFilterFlashbackOption>((row) => ({
        id: row.id,
        text: row.text,
        memoryTitle: row.memoryTitle,
      }));
    } catch {
      return [];
    }
  });

  const [additionalPages, setAdditionalPages] = createSignal<BrowseMemoryPage[]>(
    [],
  );
  const [isLoadingNextPage, setIsLoadingNextPage] = createSignal(false);
  const [loadNextPageError, setLoadNextPageError] = createSignal("");
  let loadNextPageGeneration = 0;
  const invalidateLoadNextPage = (): void => {
    loadNextPageGeneration += 1;
    setIsLoadingNextPage(false);
    setLoadNextPageError("");
  };

  const [removedMemoryIds, setRemovedMemoryIds] = createSignal<
    ReadonlySet<string>
  >(new Set());
  const [triagedOutMemoryIds, setTriagedOutMemoryIds] = createSignal<
    ReadonlySet<string>
  >(new Set());
  const [restoredMemories, setRestoredMemories] = createSignal<BrowseMemory[]>(
    [],
  );
  const [triageError, setTriageError] = createSignal("");
  const [undoEntry, setUndoEntry] = createSignal<UndoTriageEntry | null>(null);
  const [todayCapDelta, setTodayCapDelta] = createSignal(0);
  const [todayCapForcedFull, setTodayCapForcedFull] = createSignal(false);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  const clearUndoTimer = (): void => {
    if (undoTimer !== undefined) {
      clearTimeout(undoTimer);
      undoTimer = undefined;
    }
  };
  const dismissUndoToast = (): void => {
    clearUndoTimer();
    setUndoEntry(null);
  };
  const showUndoToast = (entry: UndoTriageEntry): void => {
    clearUndoTimer();
    setUndoEntry(entry);
    undoTimer = setTimeout(() => {
      undoTimer = undefined;
      setUndoEntry(null);
    }, UNDO_TOAST_DURATION_MS);
  };
  onCleanup(clearUndoTimer);

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
      return (
        state?.status === "ready" &&
        buildBrowseHref(state.query, {}) === requestedQueryKey
      );
    },
    revalidatePage: () =>
      revalidateBrowseMemoryFirstPage(query(), pageRequestOptions()),
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

  const visibleMemories = createMemo(() => {
    const removed = removedMemoryIds();
    const triagedOut = triagedOutMemoryIds();
    const base = pages()
      .flatMap((page) => page.memories)
      .filter((memory) => !removed.has(memory.id) && !triagedOut.has(memory.id));
    const existingIds = new Set(base.map((memory) => memory.id));
    const restored = restoredMemories().filter(
      (memory) =>
        !existingIds.has(memory.id) &&
        !removed.has(memory.id) &&
        !triagedOut.has(memory.id),
    );
    return restored.length > 0 ? [...restored, ...base] : base;
  });

  const shelfActiveMemories = createMemo(() => {
    if (activeLane() !== "shelf" || !isEphemeralShelfEnabled()) {
      return visibleMemories();
    }
    return visibleMemories().filter((memory) => memory.shelfExpired !== true);
  });
  const shelfStillHereMemories = createMemo(() => {
    if (activeLane() !== "shelf" || !isEphemeralShelfEnabled()) {
      return [];
    }
    return visibleMemories().filter((memory) => memory.shelfExpired === true);
  });
  const orderedVisibleMemories = createMemo(() =>
    activeLane() === "shelf" && isEphemeralShelfEnabled()
      ? [...shelfActiveMemories(), ...shelfStillHereMemories()]
      : visibleMemories(),
  );

  const isTodayAtCap = createMemo(() => {
    if (todayCapForcedFull()) {
      return true;
    }
    if (!isEphemeralShelfEnabled()) {
      return false;
    }
    const cap = dailyPickCap();
    const baseCount =
      activeLane() === "today"
        ? visibleMemories().length
        : (todayCapProbePage()?.memories.length ?? 0);
    return baseCount + todayCapDelta() >= cap;
  });

  const visibleMemoryIds = createMemo(() =>
    orderedVisibleMemories().map((memory) => memory.id),
  );
  const [flashbacksByMemoryId, setFlashbacksByMemoryId] = createSignal<
    Record<string, BrowseFlashback[]>
  >({});
  const [, setCurrentFirstPage] = createSignal<BrowseMemoryPage | undefined>(
    undefined,
  );
  const [loadMoreSentinel, setLoadMoreSentinel] = createSignal<
    HTMLDivElement | undefined
  >(undefined);
  const [isClientReady, setIsClientReady] = createSignal(false);
  const [selectedMemoryId, setSelectedMemoryId] = createSignal<string | null>(
    null,
  );
  let searchInput: HTMLInputElement | undefined;
  const memoryLinkRefs = new Map<string, HTMLAnchorElement>();

  const isGrid = createMemo(
    () => activeLane() === "library" && query().view === "grid",
  );
  const isInArchive = createMemo(() => hasBrowseInArchiveFilter(query().q));
  const laneTitle = createMemo(() => LANE_TITLES[activeLane()]);

  const activeSelectedMemoryId = createMemo(() => {
    const memories = orderedVisibleMemories();
    if (memories.length === 0) {
      return null;
    }
    const current = selectedMemoryId();
    if (current !== null && memories.some((memory) => memory.id === current)) {
      return current;
    }
    return memories[0]?.id ?? null;
  });

  const selectedMemoryIndex = createMemo(() => {
    const currentId = activeSelectedMemoryId();
    if (currentId === null) {
      return -1;
    }
    return orderedVisibleMemories().findIndex(
      (memory) => memory.id === currentId,
    );
  });
  const selectedMemory = createMemo(() => {
    const index = selectedMemoryIndex();
    return index === -1 ? undefined : orderedVisibleMemories()[index];
  });

  const flashbackRequestMemoryIds = createMemo(() => {
    const hydratedFlashbacks = flashbacksByMemoryId();
    return visibleMemoryIds().filter(
      (memoryId) => hydratedFlashbacks[memoryId] === undefined,
    );
  });

  const loadedFlashbacksByMemoryId = createAsync(async () => {
    const requestIds = flashbackRequestMemoryIds();
    const selectedFlashbackId = query().flashback;
    if (
      activeLane() !== "library" ||
      requestIds.length === 0 ||
      (selectedFlashbackId === "" && query().q.trim() === "")
    ) {
      return {};
    }

    try {
      return await getBrowseFlashbacksForMemories({
        memoryIds: requestIds,
        selectedFlashbackId: query().flashback,
      });
    } catch {
      return {};
    }
  });

  createEffect(() => {
    const nextFirstPage = firstPageForCurrentQuery();
    setCurrentFirstPage((previousFirstPage) => {
      if (
        previousFirstPage !== undefined &&
        nextFirstPage !== undefined &&
        previousFirstPage !== nextFirstPage
      ) {
        invalidateLoadNextPage();
        setAdditionalPages([]);
        setFlashbacksByMemoryId({});
      }

      return nextFirstPage;
    });
  });

  createEffect(() => {
    if (todayCapProbePage() !== undefined) {
      setTodayCapDelta(0);
    }
  });

  const updateQuery = (
    patch: Parameters<typeof buildBrowseHref>[1],
    options: { replace?: boolean } = {},
  ) => {
    navigate(buildBrowseHref(query(), patch), { replace: options.replace });
  };

  const focusSearchInput = (): void => {
    if (searchInput !== undefined) {
      searchInput.focus();
      const cursorPosition = searchInput.value.length;
      searchInput.setSelectionRange(cursorPosition, cursorPosition);
      return;
    }
    navigate("/memories?lane=library");
  };

  const focusMemoryRowById = (memoryId: string | null): void => {
    if (memoryId === null) {
      pageRegionRef?.focus({ preventScroll: true });
      return;
    }
    setSelectedMemoryId(memoryId);
    queueMicrotask(() => {
      const link = memoryLinkRefs.get(memoryId);
      if (link !== undefined && link.isConnected) {
        link.focus({ preventScroll: false });
        link.closest("article")?.scrollIntoView({ block: "nearest" });
      }
    });
  };

  const selectMemoryAt = (index: number, focusDom = true): void => {
    const memories = orderedVisibleMemories();
    if (memories.length === 0) {
      setSelectedMemoryId(null);
      return;
    }

    const clampedIndex = Math.min(Math.max(index, 0), memories.length - 1);
    const memory = memories[clampedIndex];
    if (memory !== undefined) {
      if (focusDom) {
        focusMemoryRowById(memory.id);
      } else {
        setSelectedMemoryId(memory.id);
      }
    }
  };

  const moveSelectedMemory = (delta: -1 | 1): void => {
    const currentIndex = selectedMemoryIndex();
    selectMemoryAt(currentIndex === -1 ? 0 : currentIndex + delta, true);
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

  const triageMemory = async (
    memory: BrowseMemory,
    targetState: MemoryTriageState,
  ): Promise<void> => {
    setTriageError("");

    if (targetState === "today" && isTodayAtCap()) {
      setTriageError(TODAY_CAP_REACHED_MESSAGE);
      return;
    }

    const fromState: MemoryTriageState =
      memory.triageState ?? (memory.read ? "library" : "shelf");
    const currentList = orderedVisibleMemories();
    const currentIndex = currentList.findIndex((item) => item.id === memory.id);
    const nextRow =
      currentIndex >= 0
        ? (currentList[currentIndex + 1] ?? currentList[currentIndex - 1] ?? null)
        : null;

    setTriagedOutMemoryIds((current) => new Set([...current, memory.id]));
    setRestoredMemories((current) =>
      current.filter((item) => item.id !== memory.id),
    );
    focusMemoryRowById(nextRow?.id ?? null);

    try {
      await setMemoryTriageState({
        memoryId: memory.id,
        triageState: targetState,
        todayCap:
          targetState === "today" && isEphemeralShelfEnabled()
            ? dailyPickCap()
            : undefined,
      });

      if (targetState === "today") {
        setTodayCapDelta((delta) => delta + 1);
      } else if (fromState === "today") {
        setTodayCapDelta((delta) => delta - 1);
        setTodayCapForcedFull(false);
      }

      showUndoToast({
        memory,
        fromState,
        toState: targetState,
        label: describeTriageAction(targetState),
      });
      void revalidateBrowseMemoryPages();
    } catch (error) {
      setTriagedOutMemoryIds((current) => {
        const next = new Set(current);
        next.delete(memory.id);
        return next;
      });
      focusMemoryRowById(memory.id);

      if (isTodayCapReachedError(error)) {
        setTodayCapForcedFull(true);
        setTriageError(TODAY_CAP_REACHED_MESSAGE);
        return;
      }

      setTriageError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Could not update lane. Please try again.",
      );
    }
  };

  const undoLastTriage = async (): Promise<void> => {
    const entry = undoEntry();
    if (entry === null) {
      return;
    }

    dismissUndoToast();
    setTriageError("");

    const currentLane = activeLane();
    setTriagedOutMemoryIds((current) => {
      const next = new Set(current);
      next.delete(entry.memory.id);
      return next;
    });
    if (entry.fromState === currentLane) {
      setRestoredMemories((current) => [
        { ...entry.memory, triageState: entry.fromState },
        ...current.filter((item) => item.id !== entry.memory.id),
      ]);
      focusMemoryRowById(entry.memory.id);
    }

    try {
      await setMemoryTriageState({
        memoryId: entry.memory.id,
        triageState: entry.fromState,
      });
      if (entry.toState === "today") {
        setTodayCapDelta((delta) => delta - 1);
        setTodayCapForcedFull(false);
      } else if (entry.fromState === "today") {
        setTodayCapDelta((delta) => delta + 1);
      }
      void revalidateBrowseMemoryPages();
    } catch (error) {
      setTriagedOutMemoryIds((current) => new Set([...current, entry.memory.id]));
      setRestoredMemories((current) =>
        current.filter((item) => item.id !== entry.memory.id),
      );
      setTriageError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Could not undo lane change.",
      );
    }
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
    const options = pageRequestOptions();
    const requestGeneration = ++loadNextPageGeneration;
    setIsLoadingNextPage(true);
    setLoadNextPageError("");
    await settleCurrentBrowsePageRequest({
      isCurrent: () =>
        requestGeneration === loadNextPageGeneration &&
        isSameBrowseQuery(query(), requestedQuery),
      loadPage: () =>
        getBrowseMemoryPage(
          createNextBrowseMemoryPageRequest(requestedQuery, cursor, options),
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
      if (
        previousQuery !== undefined &&
        !isSameBrowseQuery(nextQuery, previousQuery)
      ) {
        invalidateLoadNextPage();
        setAdditionalPages([]);
        setFlashbacksByMemoryId({});
        setRemovedMemoryIds(new Set<string>());
        setTriagedOutMemoryIds(new Set<string>());
        setRestoredMemories([]);
        setLoadNextPageError("");
        setTriageError("");
        setTodayCapDelta(0);
        setTodayCapForcedFull(false);
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

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveSelectedMemory(1);
        return;
      }

      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelectedMemory(-1);
        return;
      }

      if (event.key === "u") {
        if (undoEntry() !== null) {
          event.preventDefault();
          void undoLastTriage();
        }
        return;
      }

      const lane = activeLane();
      const currentMemory = selectedMemory();

      if (lane === "shelf" && currentMemory !== undefined) {
        if (event.key === "p") {
          event.preventDefault();
          void triageMemory(currentMemory, "today");
          return;
        }
        if (event.key === "l") {
          event.preventDefault();
          void triageMemory(currentMemory, "library");
          return;
        }
        if (event.key === "x") {
          event.preventDefault();
          void triageMemory(currentMemory, "archive");
          return;
        }
      }

      if (lane === "today" && currentMemory !== undefined && event.key === "x") {
        event.preventDefault();
        void triageMemory(currentMemory, "archive");
        return;
      }

      if (event.key === "Enter") {
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

  const renderMemoryRow = (memory: BrowseMemory) => {
    const memoryFlashbacks = createMemo(
      () => flashbacksByMemoryId()[memory.id],
    );
    const isRovingTabStop = createMemo(
      () => activeSelectedMemoryId() === memory.id,
    );

    return (
      <MemoryItem
        memory={memory}
        lane={activeLane()}
        inArchive={isInArchive()}
        pickDisabled={isTodayAtCap()}
        flashbacks={memoryFlashbacks() ?? []}
        flashbacksHydrated={memoryFlashbacks() !== undefined}
        availableCategories={availableCategories()}
        availableTags={availableTags()}
        selectedFlashbackId={query().flashback}
        isKeyboardSelected={selectedMemoryId() === memory.id}
        isRovingTabStop={isRovingTabStop()}
        view={query().view}
        getPageRegion={() => pageRegionRef}
        onRowFocus={(id) => setSelectedMemoryId(id)}
        onOpenLinkMount={(element) => {
          memoryLinkRefs.set(memory.id, element);
          onCleanup(() => {
            if (memoryLinkRefs.get(memory.id) === element) {
              memoryLinkRefs.delete(memory.id);
            }
          });
        }}
        onDeleted={(memoryId) =>
          setRemovedMemoryIds((current) => new Set([...current, memoryId]))
        }
        onTriage={(targetState) => void triageMemory(memory, targetState)}
        onMemoryMutated={clearAdditionalBrowsePages}
      />
    );
  };

  return (
    <section
      class={pageFrame}
      aria-labelledby="memories-title"
      data-browse-lane={activeLane()}
    >
      <Title>{laneTitle()} | TRAUMA</Title>
      <header class="trauma-memory-browse-header sticky top-0 z-[2] flex items-center justify-between gap-4 border-b border-trauma-border bg-trauma-bg-surface/95 px-6 py-3.5 backdrop-blur">
        <h1
          id="memories-title"
          class="mb-0 text-lg font-semibold tracking-tight text-trauma-text-primary"
        >
          {laneTitle()}
        </h1>
        <Show when={activeLane() === "shelf" && isTodayAtCap()}>
          <p
            class="mb-0 text-xs text-trauma-text-muted"
            data-today-cap-notice="true"
            role="status"
          >
            {TODAY_CAP_REACHED_MESSAGE}
          </p>
        </Show>
        <Show when={activeLane() === "today" && isTodayAtCap()}>
          <p
            class="mb-0 text-xs text-trauma-text-muted"
            data-today-cap-notice="true"
            role="status"
          >
            {TODAY_CAP_REACHED_MESSAGE}
          </p>
        </Show>
      </header>

      <Show when={activeLane() === "library"}>
        <MemorySearchBar
          disabled={!isClientReady()}
          onSearchInputMount={(input) => {
            searchInput = input;
          }}
        >
          <LibraryFiltersPopover
            query={query()}
            categories={availableCategories()}
            tags={availableTags()}
            flashbacks={recentFlashbacks() ?? []}
            disabled={!isClientReady()}
            onSelectCategory={(category) =>
              updateQuery({ lane: "library", category })
            }
            onSelectTag={(tag) => updateQuery({ lane: "library", tag })}
            onSelectFlashback={(flashback) =>
              updateQuery({ lane: "library", flashback })
            }
            onToggleArchive={(includeArchive) =>
              updateQuery({
                lane: "library",
                q: setBrowseInArchiveFilter(query().q, includeArchive),
              })
            }
            onSelectSort={(sort: BrowseSort) =>
              updateQuery({
                lane: "library",
                sort: sort === "last_opened" ? "last_opened" : undefined,
              })
            }
            onSelectView={(view: BrowseView) =>
              updateQuery({ lane: "library", view })
            }
            onClearFilters={() =>
              updateQuery({
                lane: "library",
                category: "",
                tag: "",
                flashback: "",
                sort: undefined,
                q: setBrowseInArchiveFilter(query().q, false),
              })
            }
          />
        </MemorySearchBar>
      </Show>

      <Show when={triageError() !== ""}>
        <div
          class="flex items-center justify-between gap-3 border-b border-trauma-border bg-trauma-bg-elev px-6 py-2.5 text-sm text-trauma-text-primary"
          data-triage-error="true"
          role="alert"
        >
          <span>{triageError()}</span>
          <button
            class="text-xs font-semibold text-trauma-text-muted hover:text-trauma-text-primary"
            type="button"
            onClick={() => setTriageError("")}
          >
            Dismiss
          </button>
        </div>
      </Show>

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
          fallback={<MemoryBrowseState title="Loading..." />}
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
              when={orderedVisibleMemories().length > 0}
              fallback={
                <Show
                  when={activeLane() === "today"}
                  fallback={
                    <MemoryBrowseState
                      message={
                        activeLane() === "shelf"
                          ? "New links you capture land here."
                          : "Adjust the search or filters."
                      }
                      title={
                        activeLane() === "shelf"
                          ? "Shelf is clear."
                          : "No matching memories"
                      }
                    />
                  }
                >
                  <div
                    class="trauma-route-row px-6 py-12 text-trauma-text-secondary"
                    data-today-empty-state="true"
                  >
                    <p class="mb-3 text-base text-trauma-text-primary">
                      Nothing picked. Choose from the Shelf when you're ready.
                    </p>
                    <A
                      class="inline-flex min-h-[36px] items-center rounded-full border border-trauma-border-strong px-4 py-1.5 text-sm font-semibold text-trauma-text-primary no-underline transition hover:bg-trauma-bg-tint"
                      href="/memories?lane=shelf"
                    >
                      Open Shelf
                    </A>
                  </div>
                </Show>
              }
            >
              <Show
                when={activeLane() === "shelf" && isEphemeralShelfEnabled()}
                fallback={
                  <div
                    aria-label={`${laneTitle()} memories`}
                    class={
                      isGrid()
                        ? "trauma-memory-list memory-grid trauma-memory-grid grid grid-cols-2"
                        : "trauma-memory-list grid"
                    }
                    role="list"
                  >
                    <For each={orderedVisibleMemories()}>
                      {(memory) => renderMemoryRow(memory)}
                    </For>
                  </div>
                }
              >
                <div
                  aria-label="Shelf memories"
                  class="trauma-memory-list grid"
                  role="list"
                >
                  <For each={shelfActiveMemories()}>
                    {(memory) => renderMemoryRow(memory)}
                  </For>
                  <Show when={shelfStillHereMemories().length > 0}>
                    <div
                      class="border-b border-trauma-border px-6 pb-2 pt-6"
                      data-shelf-still-here="true"
                      role="presentation"
                    >
                      <h2 class="mb-0 text-xs font-semibold uppercase tracking-wide text-trauma-text-muted">
                        Still here
                      </h2>
                    </div>
                    <For each={shelfStillHereMemories()}>
                      {(memory) => renderMemoryRow(memory)}
                    </For>
                  </Show>
                </div>
              </Show>
            </Show>

            <Show when={nextCursor() !== null}>
              <div class="flex flex-col items-center gap-2 px-6 py-6">
                <Show when={loadNextPageError() !== ""}>
                  <p
                    class="mb-0 text-xs font-semibold text-trauma-danger"
                    role="alert"
                  >
                    {loadNextPageError()}
                  </p>
                </Show>
                <button
                  class="inline-flex min-h-[38px] items-center justify-center rounded-full border border-trauma-border-strong bg-trauma-bg-surface px-4 py-1.5 text-sm font-semibold text-trauma-text-primary transition hover:bg-trauma-bg-tint disabled:opacity-50"
                  disabled={isLoadingNextPage()}
                  type="button"
                  onClick={() => void loadNextPage()}
                >
                  {isLoadingNextPage() ? "Loading..." : "Load more"}
                </button>
              </div>
            </Show>
            <div aria-hidden="true" class="h-px" ref={setLoadMoreSentinel} />
          </Show>
        </Show>
      </div>

      <Show when={undoEntry()}>
        {(entry) => (
          <div
            class="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-trauma-border-strong bg-trauma-bg-elev px-4 py-2 text-sm text-trauma-text-primary shadow-trauma-2 max-[720px]:bottom-[calc(5.25rem+var(--trauma-layout-safe-area-bottom))]"
            data-triage-undo-toast="true"
            role="status"
            aria-live="polite"
          >
            <span>{entry().label}</span>
            <button
              class="rounded-full border border-trauma-border-strong bg-trauma-bg-surface px-3 py-0.5 text-xs font-semibold text-trauma-text-primary transition hover:bg-trauma-bg-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent"
              type="button"
              onClick={() => void undoLastTriage()}
            >
              Undo
            </button>
          </div>
        )}
      </Show>
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
      <h2 class="text-base font-semibold text-trauma-text-primary">
        {props.title}
      </h2>
      <Show when={props.message}>
        {(message) => <p class="mb-0 mt-1 text-sm">{message()}</p>}
      </Show>
      {props.children}
    </div>
  );
}

export function MemoryBrowseInitialPageFailure(props: {
  getFocusTarget: () => HTMLElement | undefined;
  onRetry: () =>
    | CollectionPageRetryOutcome
    | Promise<CollectionPageRetryOutcome>;
}) {
  return (
    <MemoryBrowseState
      message="Retry the current view."
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

export function MemoryItem(props: {
  availableCategories?: readonly BrowseTaxonomySummaryItem[];
  availableTags?: readonly BrowseTaxonomySummaryItem[];
  flashbacks?: readonly BrowseFlashback[];
  flashbacksHydrated?: boolean;
  inArchive?: boolean;
  isKeyboardSelected?: boolean;
  isRovingTabStop?: boolean;
  lane?: BrowseLane;
  memory: BrowseMemory;
  pickDisabled?: boolean;
  selectedFlashbackId: string;
  view: "list" | "grid";
  getPageRegion?: () => HTMLElement | undefined;
  onDeleted?: (memoryId: string) => void;
  onMemoryMutated?: () => void;
  onOpenLinkMount?: (link: HTMLAnchorElement) => void;
  onRowFocus?: (memoryId: string) => void;
  onTriage?: (targetState: MemoryTriageState) => void;
}) {
  let rowRef: HTMLElement | undefined;
  const lane = createMemo<BrowseLane>(() => props.lane ?? "library");
  const displayFlashback = createMemo(() =>
    getMemoryDisplayFlashback(
      props.memory,
      props.selectedFlashbackId,
      props.flashbacks,
    ),
  );
  const host = createMemo(() => getHostLabel(props.memory.url));
  const faviconInitial = createMemo(() =>
    host().charAt(0).toLocaleUpperCase(),
  );
  const lengthBucket = createMemo(() => getLengthBucket(props.memory.wordCount));
  const resumptionCue = createMemo(() =>
    formatResumptionCue(props.memory.lastPosition),
  );
  const secondaryMetaText = createMemo(() => {
    const parts: string[] = [host()];
    const bucket = lengthBucket();
    if (bucket !== null) {
      parts.push(bucket);
    }
    const cue = resumptionCue();
    if (cue !== null) {
      parts.push(cue);
    }
    return parts.join(" · ");
  });

  const isSelected = createMemo(() => props.isKeyboardSelected === true);
  const [tags, setTags] = createSignal<BrowseTaxonomyItem[]>(props.memory.tags);
  const [categories, setCategories] = createSignal<BrowseTaxonomyItem[]>(
    props.memory.categories,
  );
  const [actionError, setActionError] = createSignal("");
  const isSelectedFlashbackHydrating = createMemo(
    () =>
      props.selectedFlashbackId.length > 0 &&
      props.flashbacksHydrated === false &&
      displayFlashback()?.id !== props.selectedFlashbackId,
  );
  const href = createMemo(() =>
    buildMemoryBrowseItemHref(
      props.memory,
      props.selectedFlashbackId,
      props.flashbacks,
    ),
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
      const restoreFocus =
        rowRef === undefined || pageRegion === undefined
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
      class={`${flatRowBase} cursor-pointer no-underline ${
        isSelected()
          ? "bg-trauma-bg-tint ring-1 ring-inset ring-trauma-border-strong"
          : ""
      } ${props.view === "grid" && lane() === "library" ? "border-r border-trauma-border" : ""}`}
      data-collection-row={props.memory.id}
      data-memory-id={props.memory.id}
      data-keyboard-selected={isSelected() ? "true" : "false"}
      role="listitem"
    >
      <a
        aria-label={`Open memory ${props.memory.title}`}
        aria-disabled={isSelectedFlashbackHydrating() ? "true" : undefined}
        class="absolute inset-0 z-0 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-trauma-accent"
        data-memory-row-link="true"
        data-collection-primary-link="true"
        href={isSelectedFlashbackHydrating() ? undefined : href()}
        ref={(element) => props.onOpenLinkMount?.(element)}
        tabIndex={props.isRovingTabStop === false ? -1 : 0}
        onFocus={() => props.onRowFocus?.(props.memory.id)}
      />

      <span
        aria-hidden="true"
        class="mt-0.5 grid size-5 shrink-0 place-items-center rounded bg-trauma-bg-elev text-[11px] font-semibold text-trauma-text-secondary"
        data-memory-favicon="true"
      >
        {faviconInitial()}
      </span>

      <div class="grid min-w-0 gap-1">
        <h2 class="mb-0 truncate text-[15px] font-semibold leading-snug text-trauma-text-primary">
          {props.memory.title}
        </h2>
        <p
          class="mb-0 truncate text-xs text-trauma-text-muted"
          data-memory-secondary-line="true"
        >
          <span>{secondaryMetaText()}</span>
          <Show when={props.memory.extractionStatus === "link_only"}>
            <span> · Link-only</span>
          </Show>
        </p>

        <Show when={lane() === "library" && displayFlashback() !== undefined}>
          <Show when={displayFlashback()}>
            {(flashback) => (
              <div class="mt-1">
                <FlashbackExcerpt
                  prefix={flashback().prefix}
                  suffix={flashback().suffix}
                  text={flashback().text}
                />
              </div>
            )}
          </Show>
        </Show>

        <Show when={lane() === "library"}>
          <div
            class="trauma-local-wrap mt-1.5"
            aria-label={`${props.memory.title} filters`}
            data-memory-taxonomy-chips="true"
          >
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
        </Show>

        <Show when={actionError() !== ""}>
          <p class="mb-0 text-xs font-bold text-trauma-danger" role="alert">
            {actionError()}
          </p>
        </Show>
      </div>

      <div class="relative z-10 flex shrink-0 items-center gap-1.5">
        <Show when={lane() === "today"}>
          <button
            aria-label={`Move ${props.memory.title} to Shelf`}
            class={rowActionButtonClass}
            title="Move to Shelf"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              props.onTriage?.("shelf");
            }}
          >
            Shelf
          </button>
          <button
            aria-label={`Archive ${props.memory.title}`}
            class={rowActionButtonClass}
            title="Move to Archive (x)"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              props.onTriage?.("archive");
            }}
          >
            Archive
          </button>
        </Show>

        <Show when={lane() === "shelf"}>
          <button
            aria-label={`Move ${props.memory.title} to Today`}
            class={rowActionButtonClass}
            disabled={props.pickDisabled === true}
            title={
              props.pickDisabled === true
                ? TODAY_CAP_REACHED_MESSAGE
                : "Move to Today (p)"
            }
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              props.onTriage?.("today");
            }}
          >
            Today
          </button>
          <button
            aria-label={`Move ${props.memory.title} to Library`}
            class={rowActionButtonClass}
            title="Move to Library (l)"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              props.onTriage?.("library");
            }}
          >
            Library
          </button>
          <button
            aria-label={`Archive ${props.memory.title}`}
            class={rowActionButtonClass}
            title="Move to Archive (x)"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              props.onTriage?.("archive");
            }}
          >
            Archive
          </button>
        </Show>

        <Show when={lane() === "library"}>
          <Show when={props.inArchive === true}>
            <button
              class={rowActionButtonClass}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                props.onTriage?.("shelf");
              }}
            >
              Restore
            </button>
          </Show>
          <MemoryReadStatusControl
            memoryId={props.memory.id}
            initialRead={props.memory.read}
            variant="icon"
            onSaved={() => {
              props.onMemoryMutated?.();
              void revalidateAfterReadStatusChange(props.memory.id);
            }}
          />
        </Show>

        <MemoryActionMenu
          memoryId={props.memory.id}
          memoryTitle={props.memory.title}
          attachedCategories={categories()}
          categoryOptions={props.availableCategories ?? []}
          onDelete={deleteMemory}
          onAttachCategoryByName={submitCategory}
        />
      </div>
    </article>
  );
}

function describeTriageAction(targetState: MemoryTriageState): string {
  switch (targetState) {
    case "today":
      return "Moved to Today.";
    case "library":
      return "Saved to Library.";
    case "archive":
      return "Moved to Archive.";
    case "shelf":
      return "Moved to Shelf.";
  }
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
  if (
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
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
