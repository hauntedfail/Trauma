import { Title } from "@solidjs/meta";
import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";

import { HighlightExcerpt } from "~/components/highlights/HighlightExcerpt";
import { getHighlightBrowseRows } from "~/components/highlights/highlights-loader";
import { classifyHighlightRows } from "~/components/highlights/route-state";

const pageFrame =
  "min-h-screen w-full bg-trauma-bg-surface max-[720px]:min-h-[calc(100vh-58px)]";
const pageHeader =
  "sticky top-0 z-[1] flex items-center justify-between gap-4 border-b border-trauma-border bg-trauma-bg-surface/95 p-6 backdrop-blur max-[720px]:top-[58px] max-[720px]:flex-col max-[720px]:items-start max-[720px]:p-5 max-[720px]:px-4";
const eyebrow = "mb-1 text-[13px] font-bold uppercase text-trauma-text-muted";
const cardBase =
  "grid min-w-0 gap-3 border-b border-trauma-border px-6 py-[22px] transition hover:bg-trauma-bg-tint max-[720px]:px-4";

export default function HighlightsIndex() {
  const highlights = createAsync(() => getHighlightBrowseRows());
  const highlightRowsState = () => classifyHighlightRows(highlights());
  const readyHighlightRows = () => {
    const state = highlightRowsState();
    return state.status === "ready" ? state.rows : undefined;
  };

  return (
    <section class={pageFrame} aria-labelledby="highlights-title">
      <Title>Highlights | TRAUMA</Title>
      <header class={pageHeader}>
        <div>
          <p class={eyebrow}>Highlighted excerpts</p>
          <h1 class="mb-0 text-3xl font-bold leading-tight" id="highlights-title">
            Highlights
          </h1>
        </div>
      </header>
      <div class="grid">
        <Show
          when={highlightRowsState().status === "loading"}
          fallback={
            <Show
              when={readyHighlightRows()}
              fallback={
                <div class="px-6 py-12 text-trauma-text-secondary">
                  <h2 class="text-xl font-bold text-trauma-text-primary">No highlights yet</h2>
                  <p>Saved reader highlights will appear here.</p>
                </div>
              }
            >
              {(rows) => (
                <For each={rows()}>
                  {(highlight) => (
                    <article class={cardBase}>
                      <header class="grid min-w-0 gap-1">
                        <div>
                          <p class="mb-0 text-[13px] text-trauma-text-muted">Source memory</p>
                          <h2 class="mb-0 text-xl font-bold leading-tight">
                            <a href={`/memories/${highlight.memoryId}#${highlight.id}`}>{highlight.memoryTitle}</a>
                          </h2>
                        </div>
                      </header>
                      <HighlightExcerpt
                        href={`/memories/${highlight.memoryId}#${highlight.id}`}
                        prefix={highlight.prefix}
                        suffix={highlight.suffix}
                        text={highlight.text}
                      />
                    </article>
                  )}
                </For>
              )}
            </Show>
          }
        >
          <div class="px-6 py-12 text-trauma-text-secondary">
            <h2 class="text-xl font-bold text-trauma-text-primary">Loading highlights...</h2>
          </div>
        </Show>
      </div>
    </section>
  );
}
