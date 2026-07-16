import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  attachCategoryToMemoryByName,
  attachTagToMemoryByName,
  deleteBrowseMemory,
  detachTagFromMemoryByName,
  isBackupFailsafeMemoryActionError,
  MemoryItem,
  settleCurrentBrowsePageRequest,
} from "../../src/components/memories/MemoryBrowse";
import type {
  BrowseMemory,
  BrowseMemoryPage,
} from "../../src/components/memories/browse-data";

const memory = {
  id: "memory-1",
  title: "Imported Memory",
  url: "https://example.com/imported",
  description: "Imported description",
  capturedAt: "2026-05-14",
  read: false,
  extractionStatus: "success",
  categories: [{ id: "research", name: "Research" }],
  tags: [{ id: "sqlite", name: "sqlite" }],
  flashbacks: [],
} satisfies BrowseMemory;
const browseSource = readFileSync("src/components/memories/MemoryBrowse.tsx", "utf8");
const searchBarSource = readFileSync("src/components/memories/MemorySearchBar.tsx", "utf8");
const addMemoryFormSource = readFileSync("src/components/memories/AddMemoryForm.tsx", "utf8");

describe("memory browse actions", () => {
  it("renders actions, read status, and attached taxonomy", () => {
    const html = renderToString(() =>
      createComponent(MemoryItem, {
        memory,
        selectedFlashbackId: "",
        view: "list",
        onDeleted: () => {},
      }),
    );

    expect(html).toContain("Memory actions for Imported Memory");
    expect(html).toContain('aria-label="Mark memory read"');
    expect(html).toContain('data-read-status-icon="unread"');
    expect(html).not.toContain(">Unread<");
    expect(html).not.toContain("Mark read");
    expect(html).toContain("Research");
    expect(html).toContain("sqlite");
    expect(html).toContain("Add tag");
    expect(html).not.toContain("data-popup-dismiss-only");
    expect(html).not.toContain("saved");
  });

  it("renders link-only status without saved label", () => {
    const html = renderToString(() =>
      createComponent(MemoryItem, {
        memory: {
          ...memory,
          extractionStatus: "link_only",
          tags: [],
        },
        selectedFlashbackId: "",
        view: "list",
        onDeleted: () => {},
      }),
    );

    expect(html).toContain("Link-only");
    expect(html).not.toContain("saved");
  });

  it("renders flashback excerpts from lazy card flashbacks", () => {
    const html = renderToString(() =>
      createComponent(MemoryItem, {
        memory,
        flashbacks: [
          {
            id: "flashback-card",
            memoryId: memory.id,
            variantKind: "source",
            langCode: null,
            translationOutputHash: null,
            text: "lazy card excerpt",
            prefix: "before",
            suffix: "after",
            createdAt: "2026-05-16T00:00:00.000Z",
          },
        ],
        selectedFlashbackId: "",
        view: "list",
        onDeleted: () => {},
      }),
    );

    expect(html).toContain("lazy card excerpt");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });

  it("does not link selected flashback filters before lazy flashbacks hydrate", () => {
    const html = renderToString(() =>
      createComponent(MemoryItem, {
        memory,
        flashbacks: [],
        flashbacksHydrated: false,
        selectedFlashbackId: "flashback-card",
        view: "list",
        onDeleted: () => {},
      }),
    );

    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('href="/memories/memory-1"');
  });

  it("links selected flashback filters once lazy flashbacks hydrate", () => {
    const html = renderToString(() =>
      createComponent(MemoryItem, {
        memory,
        flashbacks: [
          {
            id: "flashback-card",
            memoryId: memory.id,
            variantKind: "translation",
            langCode: "ja-JP",
            translationOutputHash: "hash-ja",
            text: "lazy card excerpt",
            prefix: "before",
            suffix: "after",
            createdAt: "2026-05-16T00:00:00.000Z",
          },
        ],
        flashbacksHydrated: true,
        selectedFlashbackId: "flashback-card",
        view: "list",
        onDeleted: () => {},
      }),
    );

    expect(html).not.toContain('aria-disabled="true"');
    expect(html).toContain('href="/memories/ja-JP/memory-1#flashback-card"');
  });

  it("posts add-tag and add-category actions by name", async () => {
    const requests: Request[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(new URL(String(input), "http://localhost"), init));
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.endsWith("/tags")
            ? { tag: { id: "tag-runtime", name: "runtime" } }
            : { category: { id: "category-notes", name: "Notes" } },
        ),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    expect(
      await attachTagToMemoryByName({
        memoryId: "memory-1",
        name: "runtime",
        fetch,
      }),
    ).toEqual({ id: "tag-runtime", name: "runtime" });
    expect(
      await attachCategoryToMemoryByName({
        memoryId: "memory-1",
        name: "Notes",
        fetch,
      }),
    ).toEqual({ id: "category-notes", name: "Notes" });
    expect(await requests[0]?.json()).toEqual({
      memoryId: "memory-1",
      name: "runtime",
    });
    expect(await requests[1]?.json()).toEqual({
      memoryId: "memory-1",
      name: "Notes",
    });
  });

  it("posts remove-tag actions by name", async () => {
    const requests: Request[] = [];

    expect(
      await detachTagFromMemoryByName({
        memoryId: "memory-1",
        name: "sqlite",
        fetch: async (input, init) => {
          requests.push(new Request(new URL(String(input), "http://localhost"), init));
          return new Response(
            JSON.stringify({ tag: { id: "tag-sqlite", name: "sqlite" } }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      }),
    ).toEqual({ id: "tag-sqlite", name: "sqlite" });
    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/tags", "DELETE"],
    ]);
    expect(await requests[0]?.json()).toEqual({
      memoryId: "memory-1",
      name: "sqlite",
    });
  });

  it("revalidates reader data after taxonomy edits from browse cards", () => {
    expect(browseSource).toContain("revalidateAfterTaxonomyChange");
    expect(browseSource).toContain("revalidateReaderMemory(memoryId)");
  });

  it("keeps search focus indication on the rounded search surface", () => {
    expect(searchBarSource).toContain("focus-within:ring-inset");
    expect(searchBarSource).toContain("focus-within:ring-trauma-border-strong");
    expect(searchBarSource).toContain("focus-visible:shadow-none");
  });

  it("uses a dedicated search bar component wired to the URL query state", () => {
    expect(browseSource).toContain("MemorySearchBar");
    expect(searchBarSource).toContain("parseBrowseQuery(location.search)");
    expect(searchBarSource).toContain("navigate(buildBrowseHref(query(), { q: value }), { replace: true })");
  });

  it("wires vim-like keyboard operation to the memories route", () => {
    expect(browseSource).toContain("onCleanup");
    expect(browseSource).toContain('document.addEventListener("keydown", handleBrowseKeyDown)');
    expect(browseSource).toContain('document.removeEventListener("keydown", handleBrowseKeyDown)');
    expect(browseSource).toContain('event.key === "j"');
    expect(browseSource).toContain('event.key === "k"');
    expect(browseSource).toContain('event.key === "/"');
    expect(browseSource).toContain('event.key === "l"');
    expect(browseSource).toContain('event.key === "Enter"');
    expect(browseSource).toContain('data-keyboard-selected={isSelected() ? "true" : "false"}');
    expect(browseSource).toContain("focusSearchInput");
    expect(browseSource).toContain("isBrowseKeyboardSuppressed");
    expect(browseSource).toContain("isNativeActivationTarget");
    expect(browseSource).toContain("memoryLinkRefs.delete(memoryId)");
    expect(searchBarSource).toContain("onSearchInputMount");
    expect(searchBarSource).toContain("event.key === \"Escape\"");
    expect(searchBarSource).toContain("event.preventDefault()");
    expect(searchBarSource).toContain("event.currentTarget.blur()");
  });

  it("loads memory browse rows from paged server queries", () => {
    expect(browseSource).toContain("getBrowseMemoryPage");
    expect(browseSource).toContain("createInitialBrowseMemoryPageRequest");
    expect(browseSource).toContain("createNextBrowseMemoryPageRequest");
    expect(browseSource).not.toContain("getBrowseMemories");
    expect(browseSource).not.toContain("filterBrowseMemories");
  });

  it("loads card flashbacks separately for currently visible memory rows", () => {
    expect(browseSource).toContain("getBrowseFlashbacksForMemories");
    expect(browseSource).toContain("visibleMemoryIds");
    expect(browseSource).toContain("flashbacksByMemoryId");
    expect(browseSource).toContain("flashbackRequestMemoryIds");
    expect(browseSource).toContain("selectedFlashbackId: query().flashback");
    expect(browseSource).toContain("flashbacks={memoryFlashbacks() ?? []}");
    expect(browseSource).toContain("flashbacksHydrated={memoryFlashbacks() !== undefined}");
  });

  it("hydrates card flashbacks only for visible memories missing from the local cache", () => {
    expect(browseSource).toContain("setFlashbacksByMemoryId");
    expect(browseSource).toContain("hydratedFlashbacks[memoryId] === undefined");
    expect(browseSource).toContain("const loadedFlashbacks = loadedFlashbacksByMemoryId()");
    expect(browseSource).toContain("Object.keys(loadedFlashbacks).length === 0");
    expect(browseSource).toContain("setFlashbacksByMemoryId((current) => ({");
    expect(browseSource).not.toContain("const memoryIds = visibleMemoryIds()");
  });

  it("resets accumulated memory pages when the route query changes", () => {
    expect(browseSource).toContain("isSameBrowseQuery");
    expect(browseSource).toContain("setAdditionalPages([])");
    expect(browseSource).toContain("setFlashbacksByMemoryId({})");
    expect(browseSource).toContain("setRemovedMemoryIds(new Set<string>())");
    expect(browseSource).toContain("setLoadNextPageError(\"\")");
  });

  it("does not load additional pages from a stale first-page cursor", () => {
    expect(browseSource).toContain("const firstPageResult = createAsync(async () => {");
    expect(browseSource).toContain("query: requestedQuery");
    expect(browseSource).toContain("const firstPageForCurrentQuery = createMemo(() => {");
    expect(browseSource).toContain(
      "!isSameBrowseQuery(currentFirstPageResult.query, query())",
    );
    expect(browseSource).toContain("firstPageForCurrentQuery() === undefined");
    expect(browseSource).toContain("createNextBrowseMemoryPageRequest(requestedQuery, cursor)");
  });

  it("clears lazy pages and card flashback cache when the first page revalidates", () => {
    const firstPageRevalidationSource = browseSource.slice(
      browseSource.indexOf("const [, setCurrentFirstPage]"),
      browseSource.indexOf("const updateQuery"),
    );

    expect(firstPageRevalidationSource).toContain(
      "setCurrentFirstPage((previousFirstPage) => {",
    );
    expect(firstPageRevalidationSource).toContain("previousFirstPage !== undefined");
    expect(firstPageRevalidationSource).toContain("previousFirstPage !== nextFirstPage");
    expect(firstPageRevalidationSource).toContain("setAdditionalPages([])");
    expect(firstPageRevalidationSource).toContain("setFlashbacksByMemoryId({})");
  });

  it("defers selected flashback hrefs until lazy flashback hydration is available", () => {
    expect(browseSource).toContain("flashbacksHydrated?: boolean");
    expect(browseSource).toContain("const isSelectedFlashbackHydrating = createMemo(() =>");
    expect(browseSource).toContain("displayFlashback()?.id !== props.selectedFlashbackId");
    expect(browseSource).toContain("href={isSelectedFlashbackHydrating() ? undefined : href()}");
    expect(browseSource).toContain("event.preventDefault()");
  });

  it("installs the load-more observer after the sentinel is rendered", () => {
    expect(browseSource).toContain("observeLoadMoreSentinel");
    expect(browseSource).toContain("createEffect(() => observeLoadMoreSentinel())");
    expect(browseSource).toContain("onCleanup(() => observer.disconnect())");
    expect(browseSource).not.toContain("loadMoreSentinel === undefined || typeof IntersectionObserver");
  });

  it("keeps empty filtered pages continuable when the server returns a cursor", () => {
    const memoriesShowStart = browseSource.indexOf(
      "when={visibleMemories().length > 0}",
    );
    const memoriesShowEnd = browseSource.indexOf("\n      </Show>", memoriesShowStart);
    const loadMoreStart = browseSource.indexOf(
      "<Show when={nextCursor() !== null}>",
      memoriesShowStart,
    );

    expect(memoriesShowStart).toBeGreaterThan(-1);
    expect(memoriesShowEnd).toBeGreaterThan(memoriesShowStart);
    expect(loadMoreStart).toBeGreaterThan(memoriesShowEnd);
  });

  it("reports handled load-more failures without rethrowing to void callers", () => {
    const loadNextPageStart = browseSource.indexOf("const loadNextPage = async");
    const loadNextPageEnd = browseSource.indexOf(
      "const clearAdditionalBrowsePages",
      loadNextPageStart,
    );
    const loadNextPageSource = browseSource.slice(
      loadNextPageStart,
      loadNextPageEnd,
    );

    expect(loadNextPageSource).toContain(
      'setLoadNextPageError("Failed to load more memories.")',
    );
    expect(loadNextPageSource).not.toContain("throw error");
  });

  it("ignores every stale load-more completion path", async () => {
    const staleSuccess = createDeferred<BrowseMemoryPage>();
    const staleFailure = createDeferred<BrowseMemoryPage>();
    const events: string[] = [];
    let current = true;
    const callbacks = {
      isCurrent: () => current,
      onError: () => events.push("error"),
      onPage: () => events.push("page"),
      onSettled: () => events.push("settled"),
    };

    const successRequest = settleCurrentBrowsePageRequest({
      ...callbacks,
      loadPage: () => staleSuccess.promise,
    });
    const failureRequest = settleCurrentBrowsePageRequest({
      ...callbacks,
      loadPage: () => staleFailure.promise,
    });
    current = false;
    staleSuccess.resolve({ memories: [], nextCursor: null });
    staleFailure.reject(new Error("stale failure"));

    await Promise.all([successRequest, failureRequest]);
    expect(events).toEqual([]);
  });

  it("clears appended pages after card mutations revalidate browse data", () => {
    expect(browseSource).toContain("clearAdditionalBrowsePages");
    expect(browseSource).toContain("onMemoryMutated={clearAdditionalBrowsePages}");
    expect(browseSource).toContain("props.onMemoryMutated?.()");
  });

  it("keeps deletion as an optimistic removed-id filter across loaded pages", () => {
    expect(browseSource).toContain("removedMemoryIds");
    expect(browseSource).toContain("flatMap((page) => page.memories)");
    expect(browseSource).toContain("setRemovedMemoryIds((current) => new Set([...current, memoryId]))");
  });

  it("uses global browse workspace revalidation after add-memory success", () => {
    expect(addMemoryFormSource).toContain("revalidateBrowseMemoryWorkspace");
    expect(addMemoryFormSource).toContain("revalidateBrowseMemoryWorkspace()");
    expect(addMemoryFormSource).not.toContain("revalidateBrowseTaxonomy");
    expect(addMemoryFormSource).not.toContain("useLocation");
    expect(addMemoryFormSource).not.toContain("parseBrowseQuery(location.search)");
    expect(addMemoryFormSource).not.toContain("revalidateBrowseMemoryFirstPage");
    expect(addMemoryFormSource).not.toContain("revalidateBrowseMemories");
  });

  it("renders memories read-state tabs instead of list and grid view controls", () => {
    expect(browseSource).toContain("MemoryReadStateTabs");
    expect(browseSource).toContain('role="tablist"');
    expect(browseSource).toContain('aria-label="Memory read status"');
    expect(browseSource).toContain("tabIndex={active() ? 0 : -1}");
    expect(browseSource).toContain("onKeyDown={(event) => handleKeyDown(event, index())}");
    expect(browseSource).toContain('event.key === "ArrowRight"');
    expect(browseSource).toContain('event.key === "Home"');
    expect(browseSource).toContain("setBrowseReadStateFilter");
    expect(browseSource).not.toContain('typeof window === "undefined"');
    expect(browseSource).not.toContain('aria-label="View mode"');
    expect(browseSource).not.toContain('hint="List view"');
    expect(browseSource).not.toContain('hint="Grid view"');
  });

  it("does not render a header subtitle above the memories title", () => {
    expect(browseSource).not.toContain("Local memory archive");
  });

  it("posts memory deletion requests", async () => {
    const requests: Request[] = [];

    await deleteBrowseMemory({
      memoryId: "memory-1",
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(null, { status: 204 });
      },
    });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/memory-1", "DELETE"],
    ]);
  });

  it("marks backup failsafe delete failures so the shell alert can refresh", async () => {
    let caught: unknown;
    try {
      await deleteBrowseMemory({
        memoryId: "memory-1",
        fetch: async () =>
          new Response(
            JSON.stringify({
              error: "Backup location changed",
              backupFailsafe: {
                kind: "backup_path_drift",
              },
            }),
            {
              status: 409,
              headers: { "content-type": "application/json" },
            },
          ),
      });
    } catch (error) {
      caught = error;
    }

    expect(isBackupFailsafeMemoryActionError(caught)).toBe(true);
  });
});

function createDeferred<T>(): {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
} {
  let rejectPromise: ((error: unknown) => void) | undefined;
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return {
    promise,
    reject: (error) => rejectPromise?.(error),
    resolve: (value) => resolvePromise?.(value),
  };
}
