import { Title } from "@solidjs/meta";
import { createAsync, useLocation } from "@solidjs/router";
import { For, Show, createMemo, createSignal } from "solid-js";

import { CollectionPagination } from "~/components/collections/CollectionPagination";
import {
  CollectionPageRetry,
  createCollectionPageRetryController,
} from "~/components/collections/CollectionPageRetry";
import {
  captureCollectionRowRemovalFocus,
} from "~/components/collections/collection-row-removal-focus";
import {
  readCollectionPageCursor,
  settleCollectionPage,
} from "~/components/collections/page-state";
import {
  deleteFlashbackBySelection,
  FlashbackActionMenu,
  type FlashbackActionMenuItem,
} from "~/components/flashbacks/FlashbackActionMenu";
import { FlashbackInlineText } from "~/components/flashbacks/FlashbackText";
import {
  getFlashbackBrowsePage,
  revalidateFlashbackBrowsePage,
  revalidateFlashbackBrowseRows,
} from "~/components/flashbacks/flashbacks-loader";
import { buildMemoryVariantAnchorHref } from "~/components/memories/memory-anchor-hrefs";
import { revalidateBrowseMemoryWorkspace } from "~/components/memories/browse-loader";
import { revalidateReaderMemory } from "~/components/reader/reader-memory-loader";
import { RouteHeader } from "~/components/layout/RouteHeader";
import { RouteState } from "~/components/layout/RouteState";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const cardBase =
  "trauma-list-row trauma-route-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-3.5";

export default function FlashbacksIndex() {
  let pageRegionRef: HTMLDivElement | undefined;
  const location = useLocation();
  const cursor = createMemo(() => readCollectionPageCursor(location.search));
  const loadedPage = createAsync(() => {
    const requestedCursor = cursor();
    return settleCollectionPage(requestedCursor, () =>
      getFlashbackBrowsePage({ cursor: requestedCursor }),
    );
  });
  const [removedFlashbackIds, setRemovedFlashbackIds] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  const currentPageState = createMemo(() => {
    const state = loadedPage();
    return state?.cursor === cursor() ? state : undefined;
  });
  const pageRetry = createCollectionPageRetryController({
    getCurrentCursor: cursor,
    isPageReady: (requestedCursor) => {
      const state = loadedPage();
      return state?.cursor === requestedCursor && state.status === "ready";
    },
    revalidatePage: revalidateFlashbackBrowsePage,
  });
  const currentPage = createMemo(() => {
    const state = currentPageState();
    return state?.status === "ready" ? state.page : undefined;
  });
  const readyFlashbackRows = createMemo(() => {
    const page = currentPage();
    if (page === undefined) {
      return undefined;
    }

    return page.flashbacks.filter((row) => !removedFlashbackIds().has(row.id));
  });
  const deleteFlashback = async (
    flashback: FlashbackActionMenuItem,
    restoreFocus?: () => void,
  ) => {
    await deleteFlashbackBySelection({ flashback });
    setRemovedFlashbackIds((current) => new Set([...current, flashback.id]));
    restoreFocus?.();
    try {
      await Promise.all([
        revalidateFlashbackBrowseRows(),
        revalidateBrowseMemoryWorkspace(),
        revalidateReaderMemory(
          flashback.memoryId,
          flashback.langCode ?? undefined,
        ),
      ]);
    } finally {
      restoreFocus?.();
    }
  };

  return (
    <section class={pageFrame} aria-labelledby="flashbacks-title">
      <Title>Flashbacks | TRAUMA</Title>
      <RouteHeader layout="single" title="Flashbacks" titleId="flashbacks-title" />
      <div class="trauma-route-column">
        <div
          ref={pageRegionRef}
          aria-busy={currentPageState() === undefined || pageRetry.isRetryingCurrentPage()}
          aria-label="Flashback page results"
          class="grid"
          role="region"
          tabIndex={-1}
        >
          <Show
            when={currentPageState() !== undefined || pageRetry.isRetryingCurrentPage()}
            fallback={
              <RouteState title="Loading flashbacks..." />
            }
          >
            <Show
              when={!pageRetry.isRetryingCurrentPage() &&
                currentPageState()?.status !== "error"}
              fallback={
                <RouteState
                  title="Failed to load flashbacks"
                  message={cursor() === null
                    ? "Retry the first page."
                    : "Retry this page or return to the first page."}
                  role="alert"
                >
                  <CollectionPageRetry
                    getFocusTarget={() => pageRegionRef}
                    onRetry={pageRetry.retryCurrentPage}
                    subject="flashbacks"
                  />
                </RouteState>
              }
            >
              <Show
                when={(readyFlashbackRows()?.length ?? 0) > 0}
                fallback={
                  <RouteState
                    title={cursor() === null
                      ? "No flashbacks yet"
                      : "No flashbacks on this page"}
                    message={cursor() === null
                      ? "Saved reader flashbacks will appear here."
                      : "Continue to the next page or return to the first page."}
                  />
                }
              >
                <div class="trauma-card-list">
                  <For each={readyFlashbackRows()}>
                    {(flashback) => {
                      let rowRef: HTMLElement | undefined;
                      return (
                        <article
                          ref={rowRef}
                          class={cardBase}
                          data-collection-row={flashback.id}
                        >
                          <a
                            class="grid min-w-0 gap-2 no-underline"
                            data-collection-primary-link="true"
                            href={buildMemoryVariantAnchorHref({
                              anchorId: flashback.id,
                              langCode: flashback.langCode,
                              memoryId: flashback.memoryId,
                            })}
                          >
                            <FlashbackInlineText
                              class="text-[15px] leading-relaxed"
                              prefix={flashback.prefix}
                              suffix={flashback.suffix}
                              text={flashback.text}
                            />
                            <footer class="flex flex-wrap gap-2 text-xs text-trauma-text-muted">
                              <span>{flashback.memoryTitle}</span>
                            </footer>
                          </a>
                          <div class="pt-0.5">
                            <FlashbackActionMenu
                              flashback={flashback}
                              onDelete={(selectedFlashback, focusOwnership) => {
                                const pageRegion = pageRegionRef;
                                return deleteFlashback(
                                  selectedFlashback,
                                  rowRef === undefined || pageRegion === undefined
                                    ? undefined
                                    : captureCollectionRowRemovalFocus({
                                        focusOwnership,
                                        pageRegion,
                                        row: rowRef,
                                      }),
                                );
                              }}
                            />
                          </div>
                        </article>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
        <CollectionPagination
          ariaLabel="Flashback pages"
          cursor={cursor()}
          nextCursor={currentPage()?.nextCursor ?? null}
          pathname="/flashbacks"
        />
      </div>
    </section>
  );
}
