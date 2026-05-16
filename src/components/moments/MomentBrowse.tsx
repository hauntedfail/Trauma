import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";

import type { MomentBrowseRow } from "~/server/moments/browse";
import { getMomentBrowseRows } from "./moments-loader";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const pageHeader =
  "trauma-route-header trauma-fluid-route-padding sticky top-0 z-[1] flex items-center justify-between gap-4 border-b border-trauma-border bg-trauma-bg-surface/95 py-6 backdrop-blur";
const eyebrow = "mb-1 text-[13px] font-bold uppercase text-trauma-text-muted";
const rowBase =
  "trauma-route-row grid min-w-0 gap-2 border-b border-trauma-border px-6 py-[22px] transition hover:bg-trauma-bg-tint";

export function MomentBrowse() {
  const moments = createAsync(() => getMomentBrowseRows());
  const rows = () => moments();

  return (
    <section class={pageFrame} aria-labelledby="moment-title">
      <header class={pageHeader}>
        <div>
          <p class={eyebrow}>Saved sections</p>
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
                {(moment) => <MomentRow moment={moment} />}
              </For>
            </Show>
          )}
        </Show>
      </div>
    </section>
  );
}

function MomentRow(props: { moment: MomentBrowseRow }) {
  const href = () => props.moment.targetAnchor === null
    ? `/memories/${props.moment.memoryId}`
    : `/memories/${props.moment.memoryId}#${props.moment.targetAnchor}`;

  return (
    <article class={rowBase}>
      <a
        class="grid min-w-0 gap-2"
        href={href()}
      >
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
          <span>h{props.moment.sectionLevel}</span>
          <span>path {props.moment.sectionPath}</span>
          <time dateTime={props.moment.createdAt}>
            {formatMomentDate(props.moment.createdAt)}
          </time>
        </footer>
      </a>
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
