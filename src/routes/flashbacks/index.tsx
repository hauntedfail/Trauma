import { Title } from "@solidjs/meta";
import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";

import { FlashbackExcerpt } from "~/components/flashbacks/FlashbackExcerpt";
import { getFlashbackBrowseRows } from "~/components/flashbacks/flashbacks-loader";
import { classifyFlashbackRows } from "~/components/flashbacks/route-state";

const pageFrame =
  "trauma-route-surface trauma-mobile-stable-viewport w-full bg-trauma-bg-surface";
const pageHeader =
  "trauma-route-header trauma-fluid-route-padding sticky top-0 z-[1] flex items-center justify-between gap-4 border-b border-trauma-border bg-trauma-bg-surface/95 py-6 backdrop-blur";
const eyebrow = "mb-1 text-[13px] font-bold uppercase text-trauma-text-muted";
const cardBase =
  "trauma-route-row grid min-w-0 gap-3 border-b border-trauma-border px-6 py-[22px] transition hover:bg-trauma-bg-tint";

export default function FlashbacksIndex() {
  const flashbacks = createAsync(() => getFlashbackBrowseRows());
  const flashbackRowsState = () => classifyFlashbackRows(flashbacks());
  const readyFlashbackRows = () => {
    const state = flashbackRowsState();
    return state.status === "ready" ? state.rows : undefined;
  };

  return (
    <section class={pageFrame} aria-labelledby="flashbacks-title">
      <Title>Flashbacks | TRAUMA</Title>
      <header class={pageHeader}>
        <div>
          <p class={eyebrow}>Marked excerpts</p>
          <h1 class="mb-0 text-3xl font-bold leading-tight" id="flashbacks-title">
            Flashbacks
          </h1>
        </div>
      </header>
      <div class="grid">
        <Show
          when={flashbackRowsState().status === "loading"}
          fallback={
            <Show
              when={readyFlashbackRows()}
              fallback={
                <div class="trauma-route-row px-6 py-12 text-trauma-text-secondary">
                  <h2 class="text-xl font-bold text-trauma-text-primary">No flashbacks yet</h2>
                  <p>Saved reader flashbacks will appear here.</p>
                </div>
              }
            >
              {(rows) => (
                <For each={rows()}>
                  {(flashback) => (
                    <article class={cardBase}>
                      <header class="grid min-w-0 gap-1">
                        <div>
                          <p class="mb-0 text-[13px] text-trauma-text-muted">Source memory</p>
                          <h2 class="mb-0 text-xl font-bold leading-tight">
                            <a href={`/memories/${flashback.memoryId}#${flashback.id}`}>{flashback.memoryTitle}</a>
                          </h2>
                        </div>
                      </header>
                      <FlashbackExcerpt
                        href={`/memories/${flashback.memoryId}#${flashback.id}`}
                        prefix={flashback.prefix}
                        suffix={flashback.suffix}
                        text={flashback.text}
                      />
                    </article>
                  )}
                </For>
              )}
            </Show>
          }
        >
          <div class="trauma-route-row px-6 py-12 text-trauma-text-secondary">
            <h2 class="text-xl font-bold text-trauma-text-primary">Loading flashbacks...</h2>
          </div>
        </Show>
      </div>
    </section>
  );
}
