import { Title } from "@solidjs/meta";
import { createAsync, useLocation } from "@solidjs/router";
import { For, Show, createMemo, createSignal, type JSX } from "solid-js";

import {
  CollectionPageRetry,
  createCollectionPageRetryController,
} from "~/components/collections/CollectionPageRetry";
import {
  buildCollectionPageHref,
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

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const cardBase =
  "trauma-route-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-trauma-border px-6 py-[22px] transition hover:bg-trauma-bg-tint";

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
  const deleteFlashback = async (flashback: FlashbackActionMenuItem) => {
    await deleteFlashbackBySelection({ flashback });
    setRemovedFlashbackIds((current) => new Set([...current, flashback.id]));
    await Promise.all([
      revalidateFlashbackBrowseRows(),
      revalidateBrowseMemoryWorkspace(),
      revalidateReaderMemory(flashback.memoryId, flashback.langCode ?? undefined),
    ]);
  };

  return (
    <section class={pageFrame} aria-labelledby="flashbacks-title">
      <Title>Flashbacks | TRAUMA</Title>
      <RouteHeader layout="single" title="Flashbacks" titleId="flashbacks-title" />
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
            <FlashbackState title="Loading flashbacks..." />
          }
        >
          <Show
            when={!pageRetry.isRetryingCurrentPage() &&
              currentPageState()?.status !== "error"}
            fallback={
              <FlashbackState
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
              </FlashbackState>
            }
          >
            <Show
              when={(readyFlashbackRows()?.length ?? 0) > 0}
              fallback={
                <FlashbackState
                  title={cursor() === null
                    ? "No flashbacks yet"
                    : "No flashbacks on this page"}
                  message={cursor() === null
                    ? "Saved reader flashbacks will appear here."
                    : "Continue to the next page or return to the first page."}
                />
              }
            >
              <For each={readyFlashbackRows()}>
                  {(flashback) => (
                    <article class={cardBase} data-collection-row={flashback.id}>
                      <a
                        class="grid min-w-0 gap-2 no-underline"
                        href={buildMemoryVariantAnchorHref({
                          anchorId: flashback.id,
                          langCode: flashback.langCode,
                          memoryId: flashback.memoryId,
                        })}
                      >
                        <FlashbackInlineText
                          class="text-base"
                          prefix={flashback.prefix}
                          suffix={flashback.suffix}
                          text={flashback.text}
                        />
                        <footer class="flex flex-wrap gap-2 text-xs font-bold text-trauma-text-muted">
                          <span>{flashback.memoryTitle}</span>
                        </footer>
                      </a>
                      <div class="pt-0.5">
                        <FlashbackActionMenu
                          flashback={flashback}
                          onDelete={deleteFlashback}
                        />
                      </div>
                    </article>
                  )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
      <CollectionPageNavigation
        cursor={cursor()}
        nextCursor={currentPage()?.nextCursor ?? null}
        pathname="/flashbacks"
      />
    </section>
  );
}

function FlashbackState(props: {
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

function CollectionPageNavigation(props: {
  cursor: string | null;
  nextCursor: string | null;
  pathname: string;
}) {
  return (
    <nav
      aria-label="Flashback pages"
      class="trauma-route-row flex items-center justify-between gap-3 px-6 py-5"
    >
      <Show when={props.cursor !== null} fallback={<span />}>
        <a class="font-bold text-trauma-link" href="/flashbacks">
          First
        </a>
      </Show>
      <Show when={props.nextCursor}>
        {(nextCursor) => (
          <a
            class="ml-auto font-bold text-trauma-link"
            href={buildCollectionPageHref(props.pathname, nextCursor())}
          >
            Next
          </a>
        )}
      </Show>
    </nav>
  );
}
