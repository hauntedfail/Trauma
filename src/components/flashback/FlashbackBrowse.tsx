import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";

import type { FlashbackBrowseRow } from "~/server/db/repositories";
import { getFlashbackBrowseRows } from "./flashbacks-loader";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const pageHeader =
  "trauma-route-header trauma-fluid-route-padding sticky top-0 z-[1] flex items-center justify-between gap-4 border-b border-trauma-border bg-trauma-bg-surface/95 py-6 backdrop-blur";
const eyebrow = "mb-1 text-[13px] font-bold uppercase text-trauma-text-muted";
const rowBase =
  "trauma-route-row grid min-w-0 gap-2 border-b border-trauma-border px-6 py-[22px] transition hover:bg-trauma-bg-tint";

export function FlashbackBrowse() {
  const flashbacks = createAsync(() => getFlashbackBrowseRows());
  const rows = () => flashbacks();

  return (
    <section class={pageFrame} aria-labelledby="flashback-title">
      <header class={pageHeader}>
        <div>
          <p class={eyebrow}>Saved sections</p>
          <h1 class="mb-0 text-3xl font-bold leading-tight" id="flashback-title">
            Flashback
          </h1>
        </div>
      </header>
      <div class="grid">
        <Show
          when={rows()}
          fallback={<FlashbackState title="Loading Flashbacks..." />}
        >
          {(readyRows) => (
            <Show
              when={readyRows().length > 0}
              fallback={
                <FlashbackState
                  title="No Flashbacks yet"
                  message="Saved reader sections will appear here."
                />
              }
            >
              <For each={readyRows()}>
                {(flashback) => <FlashbackRow flashback={flashback} />}
              </For>
            </Show>
          )}
        </Show>
      </div>
    </section>
  );
}

function FlashbackRow(props: { flashback: FlashbackBrowseRow }) {
  return (
    <article class={rowBase}>
      <a
        class="grid min-w-0 gap-2"
        href={`/memories/${props.flashback.memoryId}#${props.flashback.sectionAnchor}`}
      >
        <header class="grid min-w-0 gap-1">
          <p class="mb-0 text-[13px] font-bold text-trauma-text-muted">
            {props.flashback.memoryTitle}
          </p>
          <h2 class="mb-0 text-xl font-bold leading-tight text-trauma-text-primary">
            {props.flashback.sectionTitle}
          </h2>
        </header>
        <p class="mb-0 wrap-anywhere text-sm text-trauma-link">
          {props.flashback.memoryUrl}
        </p>
        <footer class="flex flex-wrap gap-2 text-xs font-bold text-trauma-text-muted">
          <span>h{props.flashback.sectionLevel}</span>
          <span>path {props.flashback.sectionPath}</span>
          <time dateTime={props.flashback.createdAt}>
            {formatFlashbackDate(props.flashback.createdAt)}
          </time>
        </footer>
      </a>
    </article>
  );
}

function FlashbackState(props: { title: string; message?: string }) {
  return (
    <div class="trauma-route-row px-6 py-12 text-trauma-text-secondary">
      <h2 class="text-xl font-bold text-trauma-text-primary">{props.title}</h2>
      <Show when={props.message}>
        {(message) => <p>{message()}</p>}
      </Show>
    </div>
  );
}

function formatFlashbackDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}
