import { createAsync } from "@solidjs/router";
import { For, Show, createSignal, onMount } from "solid-js";

import type { MomentBrowseRow } from "~/server/moments/browse";
import { deleteMomentById } from "./moment-action-requests";
import { MomentActionMenu } from "./MomentActionMenu";
import { getMomentBrowseRows, revalidateMomentBrowseRows } from "./moments-loader";
import { revalidateReaderMemory } from "../reader/reader-memory-loader";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const pageHeader =
  "trauma-route-header trauma-fluid-route-padding sticky top-0 z-[1] flex items-center justify-between gap-4 border-b border-trauma-border bg-trauma-bg-surface/95 py-6 backdrop-blur";
const rowBase =
  "trauma-route-row grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-trauma-border px-6 py-[22px] transition hover:bg-trauma-bg-tint";

export function MomentBrowse() {
  const moments = createAsync(() => getMomentBrowseRows());
  const [deletedMomentIds, setDeletedMomentIds] = createSignal(new Set<string>());
  const rows = () => {
    const currentMoments = moments();
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
  onMount(() => {
    void revalidateMomentBrowseRows();
  });

  return (
    <section class={pageFrame} aria-labelledby="moment-title">
      <header class={pageHeader}>
        <div>
          <h1 class="mb-0 text-3xl font-bold leading-tight" id="moment-title">
            Moment
          </h1>
        </div>
      </header>
      <div class="grid">
        <Show
          when={rows()}
          fallback={<MomentState title="Loading Moments..." />}
        >
          {(readyRows) => (
            <Show
              when={readyRows().length > 0}
              fallback={
                <MomentState
                  title="No Moments yet"
                  message="Saved reader sections will appear here."
                />
              }
            >
              <For each={readyRows()}>
                {(moment) => (
                  <MomentRow
                    moment={moment}
                    onDeleteMoment={deleteMoment}
                  />
                )}
              </For>
            </Show>
          )}
        </Show>
      </div>
    </section>
  );
}

function MomentRow(props: {
  moment: MomentBrowseRow;
  onDeleteMoment: (momentId: string, memoryId: string) => Promise<void>;
}) {
  const href = () => props.moment.targetAnchor === null
    ? `/memories/${props.moment.memoryId}`
    : `/memories/${props.moment.memoryId}#${props.moment.targetAnchor}`;

  return (
    <article class={rowBase}>
      <a class="grid min-w-0 gap-2" href={href()}>
        <header class="grid min-w-0 gap-1">
          <p class="mb-0 text-[13px] font-bold text-trauma-text-muted">
            {props.moment.memoryTitle}
          </p>
          <h2 class="mb-0 text-xl font-bold leading-tight text-trauma-text-primary">
            {props.moment.sectionTitle}
          </h2>
        </header>
        <p class="mb-0 wrap-anywhere text-sm text-trauma-link">
          {props.moment.memoryUrl}
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

function MomentState(props: { title: string; message?: string }) {
  return (
    <div class="trauma-route-row px-6 py-12 text-trauma-text-secondary">
      <h2 class="text-xl font-bold text-trauma-text-primary">{props.title}</h2>
      <Show when={props.message}>
        {(message) => <p>{message()}</p>}
      </Show>
    </div>
  );
}

function formatMomentDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}
