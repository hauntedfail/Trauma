import { createAsync, useLocation } from "@solidjs/router";
import { For, Show, createMemo, createSignal, type JSX } from "solid-js";

import type { MomentBrowseRow } from "~/server/moments/browse";
import {
  CollectionPageRetry,
  createCollectionPageRetryController,
} from "../collections/CollectionPageRetry";
import {
  buildCollectionPageHref,
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
import { ScrollableUrlText } from "../url/ScrollableUrlText";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const rowBase =
  "trauma-route-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-trauma-border px-6 py-[22px] transition hover:bg-trauma-bg-tint";

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
  ): Promise<void> => {
    await deleteMomentById({ momentId });
    setDeletedMomentIds((current) => new Set([...current, momentId]));
    await Promise.all([
      revalidateMomentBrowseRows(),
      revalidateReaderMemory(memoryId),
    ]);
  };
  return (
    <section class={pageFrame} aria-labelledby="moment-title">
      <RouteHeader layout="single" title="Moment" titleId="moment-title" />
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
          fallback={<MomentState title="Loading Moments..." />}
        >
          <Show
            when={!pageRetry.isRetryingCurrentPage() &&
              currentPageState()?.status !== "error"}
            fallback={
              <MomentState
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
              </MomentState>
            }
          >
            <Show
              when={(rows()?.length ?? 0) > 0}
              fallback={
                <MomentState
                  title={cursor() === null ? "No Moments yet" : "No Moments on this page"}
                  message={cursor() === null
                    ? "Saved reader sections will appear here."
                    : "Continue to the next page or return to the first page."}
                />
              }
            >
              <For each={rows()}>
                {(moment) => (
                  <MomentRow
                    moment={moment}
                    onDeleteMoment={deleteMoment}
                  />
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
      <MomentPageNavigation
        cursor={cursor()}
        nextCursor={currentPage()?.nextCursor ?? null}
      />
    </section>
  );
}

function MomentRow(props: {
  moment: MomentBrowseRow;
  onDeleteMoment: (momentId: string, memoryId: string) => Promise<void>;
}) {
  const href = () =>
    buildMemoryAnchorHref({
      anchorId: props.moment.targetAnchor,
      memoryId: props.moment.memoryId,
    });

  return (
    <article class={rowBase} data-collection-row={props.moment.id}>
      <a class="grid min-w-0 gap-2" href={href()}>
        <header class="grid min-w-0 gap-1">
          <p class="mb-0 text-[13px] font-bold text-trauma-text-muted">
            {props.moment.memoryTitle}
          </p>
          <h2 class="mb-0 text-xl font-bold leading-tight text-trauma-text-primary">
            {props.moment.sectionTitle}
          </h2>
        </header>
        <p class="mb-0 text-sm text-trauma-link">
          <ScrollableUrlText url={props.moment.memoryUrl} />
        </p>
        <footer class="flex flex-wrap gap-2 text-xs font-bold text-trauma-text-muted">
          <Show when={props.moment.targetStatus === "stale"}>
            <span class="rounded-full border border-trauma-border bg-trauma-bg-elev px-2 py-0.5 text-trauma-text-secondary">
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
          onDelete={(momentId) =>
            props.onDeleteMoment(momentId, props.moment.memoryId)
          }
        />
      </div>
    </article>
  );
}

function MomentState(props: {
  children?: JSX.Element;
  title: string;
  message?: string;
  role?: "alert";
}) {
  return (
    <div
      class="trauma-route-row px-6 py-12 text-trauma-text-secondary"
      role={props.role}
    >
      <h2 class="text-xl font-bold text-trauma-text-primary">{props.title}</h2>
      <Show when={props.message}>
        {(message) => <p>{message()}</p>}
      </Show>
      {props.children}
    </div>
  );
}

function MomentPageNavigation(props: {
  cursor: string | null;
  nextCursor: string | null;
}) {
  return (
    <nav
      aria-label="Moment pages"
      class="trauma-route-row flex items-center justify-between gap-3 px-6 py-5"
    >
      <Show when={props.cursor !== null} fallback={<span />}>
        <a class="font-bold text-trauma-link" href="/moments">
          First
        </a>
      </Show>
      <Show when={props.nextCursor}>
        {(nextCursor) => (
          <a
            class="ml-auto font-bold text-trauma-link"
            href={buildCollectionPageHref("/moments", nextCursor())}
          >
            Next
          </a>
        )}
      </Show>
    </nav>
  );
}

function formatMomentDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}
