import { Title } from "@solidjs/meta";
import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";

import { getHighlightBrowseRows } from "~/components/highlights/highlights-loader";
import { classifyHighlightRows } from "~/components/highlights/route-state";

const pageFrame =
  "mx-auto min-h-screen w-[min(100%,840px)] border-x border-trauma-border bg-white max-[720px]:min-h-[calc(100vh-58px)] max-[720px]:border-x-0";
const pageHeader =
  "flex items-center justify-between gap-4 border-b border-trauma-border p-6 max-[720px]:flex-col max-[720px]:items-start max-[720px]:p-5 max-[720px]:px-4";
const eyebrow = "mb-1 text-[13px] font-bold uppercase text-trauma-text-muted";
const cardBase =
  "grid min-w-0 gap-3 border-b border-trauma-border px-6 py-[22px] max-[720px]:px-4";
const highlightQuote =
  "m-0 grid gap-1 border-l-[3px] border-[#c57b57] bg-[#fff8ee] px-3 py-2.5 leading-normal text-[#59483d]";
const highlightMark =
  "w-fit rounded px-1 py-px bg-[#ffe2a8] text-[#3d2b12]";

export default function HighlightsIndex() {
  const highlights = createAsync(() => getHighlightBrowseRows());
  const highlightRowsState = () => classifyHighlightRows(highlights());
  const readyHighlightRows = () => {
    const state = highlightRowsState();
    return state.status === "ready" ? state.rows : undefined;
  };

  return (
    <section class={pageFrame} aria-labelledby="highlights-title">
      <Title>Highlights | Trauma</Title>
      <header class={pageHeader}>
        <div>
          <p class={eyebrow}>Highlighted excerpts</p>
          <h1 class="mb-0 text-3xl font-bold leading-tight" id="highlights-title">Highlights</h1>
        </div>
      </header>
      <div class="grid">
        <Show
          when={highlightRowsState().status === "loading"}
          fallback={
            <Show
              when={readyHighlightRows()}
              fallback={
                <div class="px-6 py-12 text-[#5f6b5a]">
                  <h2 class="text-xl font-bold text-trauma-text-primary">No highlights yet</h2>
                  <p>Saved reader highlights will appear here.</p>
                </div>
              }
            >
              {(rows) => (
                <For each={rows()}>
                  {(highlight) => (
                    <article class={cardBase}>
                      <header class="flex items-start justify-between gap-4 max-[720px]:grid">
                        <div>
                          <p class="mb-0 text-[13px] text-trauma-text-muted">Source memory</p>
                          <h2 class="mb-0 text-xl font-bold leading-tight">
                            <a href={`/memories/${highlight.memoryId}#${highlight.id}`}>{highlight.memoryTitle}</a>
                          </h2>
                        </div>
                      </header>
                      <a class="block no-underline" href={`/memories/${highlight.memoryId}#${highlight.id}`}>
                        <blockquote class={highlightQuote}>
                          <span>{highlight.prefix}</span>
                          <mark class={highlightMark}>{highlight.text}</mark>
                          <span>{highlight.suffix}</span>
                        </blockquote>
                      </a>
                    </article>
                  )}
                </For>
              )}
            </Show>
          }
        >
          <div class="px-6 py-12 text-[#5f6b5a]">
            <h2 class="text-xl font-bold text-trauma-text-primary">Loading highlights...</h2>
          </div>
        </Show>
      </div>
    </section>
  );
}
