import { createAsync, useLocation } from "@solidjs/router";
import { For, Show, createMemo, createSignal } from "solid-js";

import type { MomentBrowseRow } from "~/server/moments/browse";
import { CollectionPagination } from "../collections/CollectionPagination";
import {
  CollectionPageRetry,
  createCollectionPageRetryController,
} from "../collections/CollectionPageRetry";
import {
  captureCollectionRowRemovalFocus,
} from "../collections/collection-row-removal-focus";
import {
  readCollectionPageCursor,
  settleCollectionPage,
} from "../collections/page-state";
import { deleteMomentById } from "./moment-action-requests";
import { MomentActionMenu } from "./MomentActionMenu";
import {
  getMomentBrowsePage,
  revalidateMomentBrowsePage,
  revalidateMomentBrowseRows,
} from "./moments-loader";
import { buildMemoryAnchorHref } from "../memories/memory-anchor-hrefs";
import { revalidateReaderMemory } from "../reader/reader-memory-loader";
import { RouteHeader } from "../layout/RouteHeader";
import { RouteState } from "../layout/RouteState";
import { ScrollableUrlText } from "../url/ScrollableUrlText";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const rowBase =
  "trauma-surface-card trauma-list-card trauma-route-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3.5";

export function MomentBrowse() {
  let pageRegionRef: HTMLDivElement | undefined;
  const location = useLocation();
  const cursor = createMemo(() => readCollectionPageCursor(location.search));
  const loadedPage = createAsync(() => {
    const requestedCursor = cursor();
    return settleCollectionPage(requestedCursor, () =>
      getMomentBrowsePage({ cursor: requestedCursor }),
    );
  });
  const [deletedMomentIds, setDeletedMomentIds] = createSignal(new Set<string>());
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
    revalidatePage: revalidateMomentBrowsePage,
  });
  const currentPage = createMemo(() => {
    const state = currentPageState();
    return state?.status === "ready" ? state.page : undefined;
  });
  const rows = () => {
    const currentMoments = currentPage()?.moments;
    if (currentMoments === undefined) {
      return undefined;
    }

    return currentMoments.filter((moment) => !deletedMomentIds().has(moment.id));
  };
  const deleteMoment = async (
    momentId: string,
    memoryId: string,
    restoreFocus?: () => void,
  ): Promise<void> => {
    await deleteMomentById({ momentId });
    setDeletedMomentIds((current) => new Set([...current, momentId]));
    restoreFocus?.();
    try {
      await Promise.all([
        revalidateMomentBrowseRows(),
        revalidateReaderMemory(memoryId),
      ]);
    } finally {
      restoreFocus?.();
    }
  };
  return (
    <section class={pageFrame} aria-labelledby="moment-title">
      <RouteHeader layout="single" title="Moments" titleId="moment-title" />
      <div class="trauma-route-column">
        <div
          ref={pageRegionRef}
          aria-busy={currentPageState() === undefined || pageRetry.isRetryingCurrentPage()}
          aria-label="Moment page results"
          class="grid"
          role="region"
          tabIndex={-1}
        >
          <Show
            when={currentPageState() !== undefined || pageRetry.isRetryingCurrentPage()}
            fallback={<RouteState title="Loading Moments..." />}
          >
            <Show
              when={!pageRetry.isRetryingCurrentPage() &&
                currentPageState()?.status !== "error"}
              fallback={
                <RouteState
                  title="Failed to load Moments"
                  message={cursor() === null
                    ? "Retry the first page."
                    : "Retry this page or return to the first page."}
                  role="alert"
                >
                  <CollectionPageRetry
                    getFocusTarget={() => pageRegionRef}
                    onRetry={pageRetry.retryCurrentPage}
                    subject="Moments"
                  />
                </RouteState>
              }
            >
              <Show
                when={(rows()?.length ?? 0) > 0}
                fallback={
                  <RouteState
                    title={cursor() === null ? "No Moments yet" : "No Moments on this page"}
                    message={cursor() === null
                      ? "Saved reader sections will appear here."
                      : "Continue to the next page or return to the first page."}
                  />
                }
              >
                <div class="trauma-card-list">
                  <For each={rows()}>
                    {(moment) => (
                      <MomentRow
                        getPageRegion={() => pageRegionRef}
                        moment={moment}
                        onDeleteMoment={deleteMoment}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
        <CollectionPagination
          ariaLabel="Moment pages"
          cursor={cursor()}
          nextCursor={currentPage()?.nextCursor ?? null}
          pathname="/moments"
        />
      </div>
    </section>
  );
}

function MomentRow(props: {
  getPageRegion: () => HTMLElement | undefined;
  moment: MomentBrowseRow;
  onDeleteMoment: (
    momentId: string,
    memoryId: string,
    restoreFocus?: () => void,
  ) => Promise<void>;
}) {
  let rowRef: HTMLElement | undefined;
  const href = () =>
    buildMemoryAnchorHref({
      anchorId: props.moment.targetAnchor,
      memoryId: props.moment.memoryId,
    });

  return (
    <article
      ref={rowRef}
      class={rowBase}
      data-collection-row={props.moment.id}
    >
      <a
        class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 no-underline"
        data-collection-primary-link="true"
        href={href()}
      >
        <header class="grid min-w-0 gap-0.5">
          <p class="mb-0 truncate text-xs text-trauma-text-muted">
            {props.moment.memoryTitle}
          </p>
          <h2 class="mb-0 text-[15px] font-semibold leading-snug text-trauma-text-primary">
            {props.moment.sectionTitle}
          </h2>
        </header>
        <p class="mb-0 text-xs text-trauma-link">
          <ScrollableUrlText url={props.moment.memoryUrl} />
        </p>
        <footer class="flex flex-wrap items-center gap-2 text-xs text-trauma-text-muted">
          <Show when={props.moment.targetStatus === "stale"}>
            <span class="rounded-full border border-trauma-border bg-trauma-bg-surface px-2 py-0.5 font-medium text-trauma-text-secondary">
              Section moved
            </span>
          </Show>
          <span>h{props.moment.sectionLevel}</span>
          <span>path {props.moment.sectionPath}</span>
          <time dateTime={props.moment.createdAt}>
            {formatMomentDate(props.moment.createdAt)}
          </time>
        </footer>
      </a>
      <div class="pt-0.5">
        <MomentActionMenu
          momentId={props.moment.id}
          sectionTitle={props.moment.sectionTitle}
          onDelete={(momentId, focusOwnership) => {
            const pageRegion = props.getPageRegion();
            return props.onDeleteMoment(
              momentId,
              props.moment.memoryId,
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
}

function formatMomentDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}
